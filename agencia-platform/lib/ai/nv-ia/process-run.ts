/**
 * Procesador centralizado de AiAgentRun.
 *
 * Antes esta lógica vivía SOLO en /api/cron/ai-agent/process. Eso
 * exigía un cron externo (Railway / GitHub Actions) llamando al
 * endpoint cada 1-2 min. Si no se configura, los runs PENDING se
 * acumulan indefinidamente — el bug que el user reportó: "encargué
 * una tarea anoche y esta mañana sigue en pendiente".
 *
 * Ahora cualquier hook que cree un AiAgentRun puede llamar a
 * `void processRunInBackground(runId)` y el procesado arranca en el
 * mismo proceso Node, sin depender de crons externos. En Railway
 * (servidor persistente, no serverless) la promesa sobrevive a la
 * respuesta HTTP que la lanzó.
 *
 * El cron viejo sigue funcionando: drena los PENDING que se hayan
 * quedado huérfanos (proceso reiniciado a mitad, crash, etc.) usando
 * la misma `processOneRun`.
 */

import { prisma } from "@/lib/db/prisma";
import { executeAgentRun, loadAgentConfig } from "@/lib/ai/nv-ia/runner";
import { escalateRunToGitHub } from "@/lib/ai/nv-ia/escalate";

export type ProcessResult =
  | { skipped: true; runId: string }
  | { runId: string; status: string; steps?: number }
  | { runId: string; status: "FAILED"; error: string };

/**
 * Procesa UN AiAgentRun. Idempotente: si el run ya no está en PENDING
 * (otro proceso lo cogió), devuelve { skipped: true }.
 *
 * NO captura excepciones de fondo del runner — las traduce a
 * status=FAILED en BD y un retorno tipado. Llamadores que la usen
 * con `void` no necesitan try/catch.
 */
export async function processOneRun(runId: string): Promise<ProcessResult> {
  console.log(`[sonia] processOneRun start: ${runId}`);
  // Lock optimista: solo si sigue PENDING.
  const claimed = await prisma.aiAgentRun.updateMany({
    where: { id: runId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() }
  });
  if (claimed.count === 0) {
    console.log(`[sonia] processOneRun skipped (not PENDING anymore): ${runId}`);
    return { skipped: true, runId };
  }

  const run = await prisma.aiAgentRun.findUnique({ where: { id: runId } });
  if (!run) {
    console.log(`[sonia] processOneRun skipped (run not found): ${runId}`);
    return { skipped: true, runId };
  }

  try {
    const config = await loadAgentConfig(run.workspaceId);
    console.log(`[sonia] executeAgentRun: task=${run.taskId} model=${config.model}`);
    const result = await executeAgentRun({
      workspaceId: run.workspaceId,
      taskId: run.taskId,
      config,
      runId: run.id,
      trigger: run.trigger,
      triggerContext: run.triggerContext
    });
    console.log(`[sonia] run ${runId} → ${result.status} (${result.stepsCount} steps)`);

    await prisma.aiAgentRun.update({
      where: { id: runId },
      data: {
        status: result.status as any,
        summary: result.summary,
        error: result.error,
        log: result.log as any,
        stepsCount: result.stepsCount,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        finishedAt: new Date()
      }
    });

    if (run.requesterId) {
      const link = `/tasks/${run.taskId}`;
      const body =
        result.status === "SUCCEEDED"
          ? `✅ Sonia terminó: ${result.summary?.slice(0, 140) ?? ""}`
          : result.status === "REQUIRES_HUMAN"
          ? `⚠️ Sonia necesita tu ayuda con una tarea — revisa los comentarios.`
          : `❌ Sonia falló al procesar una tarea: ${result.error?.slice(0, 140) ?? "error desconocido"}`;
      await prisma.notification
        .create({
          data: {
            userId: run.requesterId,
            type: "ai_agent_run",
            body,
            link
          }
        })
        .catch(() => {});
    }

    // AUTO-PROMOCIÓN FAILED → REQUIRES_HUMAN para errores técnicos.
    //
    // Filosofía: Sonia NUNCA debería declararse FAILED sin antes
    // pedirme ayuda a mí (Claude Code). Si el error es técnico (bug
    // del runner, error 4xx/5xx de Anthropic, payload mal formado,
    // tool sin implementar...), no es problema del user — es
    // problema MIO que debo arreglar.
    //
    // Promovemos a REQUIRES_HUMAN + comentario "estoy investigando"
    // para que la UI muestre azul "Claude trabajando" en vez de
    // rojo "Sonia falló". Cuando Claude termine el fix, el endpoint
    // ai-reprocess re-dispara la task automáticamente.
    //
    // Si en cambio el error es de credenciales / config del workspace
    // (token caducado, permiso denegado, integración no configurada),
    // mantenemos FAILED — Claude no puede arreglar eso, el user sí.
    let finalStatus = result.status;
    if (result.status === "FAILED" && classifyError(result.error ?? "") === "technical") {
      finalStatus = "REQUIRES_HUMAN" as any;
      const explainer =
        `❓ Me he topado con un problema técnico al procesar esta tarea y se lo he pedido a Claude Code para que lo arregle:\n\n` +
        `**Error:** ${(result.error ?? "(sin detalle)").slice(0, 400)}\n\n` +
        `Mientras tanto no necesitas hacer nada — cuando Claude aplique la mejora, la tarea se re-procesa automáticamente y recibirás aviso.`;
      try {
        await prisma.aiAgentRun.update({
          where: { id: runId },
          data: { status: finalStatus as any }
        });
        // Comentario informativo firmado por Sonia.
        const ws = await prisma.workspace.findUnique({
          where: { id: run.workspaceId },
          select: { settings: true }
        }).catch(() => null);
        const aiUserId = (ws?.settings as any)?.aiAgent?.userId;
        if (aiUserId) {
          await prisma.comment.create({
            data: {
              workspaceId: run.workspaceId,
              authorId: aiUserId,
              targetType: "TASK",
              targetId: run.taskId,
              body: explainer
            }
          }).catch(() => {});
        }
      } catch (e) {
        console.warn("[sonia] promote FAILED→REQUIRES_HUMAN:", (e as Error).message);
      }
    }

    // AUTO-ESCALACIÓN a Claude Code via GitHub Issue.
    // Cuando Sonia falla o pide ayuda, abrimos un issue con @claude
    // mention y el contexto entero. Si el repo tiene la GitHub App
    // de Claude Code instalada, Claude lo analiza solo, hace PR
    // con el fix, y re-dispara la task — TOTALMENTE automático
    // sin que el user tenga que hacer nada.
    // Si las env vars no están configuradas, esto es no-op
    // silencioso (no rompe el run ni la notificación al user).
    if (finalStatus === "FAILED" || finalStatus === "REQUIRES_HUMAN") {
      void escalateRunToGitHub(runId)
        .then((esc) => {
          if (esc.ok) {
            console.log(`[sonia] escalado run ${runId} → ${esc.issueUrl}`);
          } else if (esc.skipped) {
            console.log(`[sonia] escalación skip: ${esc.reason}`);
          } else {
            console.warn(`[sonia] escalación fallida: ${esc.error}`);
          }
        })
        .catch((e) => console.warn("[sonia] escalateRunToGitHub crash:", e?.message ?? e));
    }

    return { runId, status: finalStatus, steps: result.stepsCount };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    await prisma.aiAgentRun
      .update({
        where: { id: runId },
        data: { status: "FAILED", error: msg, finishedAt: new Date() }
      })
      .catch(() => {});
    // Igual escalamos cuando el runner explotó por completo (excepción
    // no capturada). Esto suele ser bug del runner, no de la task.
    void escalateRunToGitHub(runId).catch(() => {});
    return { runId, status: "FAILED", error: msg };
  }
}

/**
 * Dispara processOneRun "fire-and-forget". Llamar como `void` desde
 * cualquier handler — el proceso Node sigue corriendo después de
 * devolver la respuesta HTTP (Railway no es serverless).
 *
 * Loguea pero NUNCA tira. Si falla, el cron-watchdog detectará el
 * run quedado en RUNNING/PENDING y lo recogerá.
 */
export function processRunInBackground(runId: string): void {
  void processOneRun(runId).catch(async (e) => {
    // CRÍTICO: si processOneRun lanza una excepción que escapa de
    // su propio try/catch interno (poco frecuente pero pasa: error
    // de import del runner, error al cargar config, etc.), antes
    // solo se logueaba. El run quedaba PENDING para siempre.
    //
    // Ahora marcamos el run como FAILED aquí mismo con el mensaje
    // de error visible. El user verá "Sonia falló" en lugar de
    // "Sonia bloqueada" — diagnosticable.
    const msg = String(e?.message ?? e);
    console.error("[sonia] background processRun fail:", runId, msg);
    try {
      await prisma.aiAgentRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          error: `processRunInBackground crash: ${msg}`,
          finishedAt: new Date()
        }
      });
    } catch (e2) {
      console.error("[sonia] no se pudo marcar FAILED:", e2);
    }
  });
}

/**
 * Clasifica el error de un run para decidir si:
 *   - "credential": el error es de credencial/permiso/config del
 *     workspace. Claude NO puede arreglarlo con código — solo el
 *     user puede dar un token nuevo, configurar la integración,
 *     etc. Mantenemos FAILED para que se vea claro al user.
 *   - "technical": bug del runner, error de API ajena (Anthropic
 *     4xx/5xx, Meta 500), tool sin implementar, payload mal
 *     formado, timeout interno, etc. Lo arreglo yo (Claude) con
 *     código. Promovemos a REQUIRES_HUMAN y escalamos.
 */
function classifyError(errorMsg: string): "credential" | "technical" {
  const m = errorMsg.toLowerCase();
  const credentialPatterns = [
    "session has expired",
    "session is invalid",
    "user logged out",
    "access token",
    "invalid token",
    "token caducado",
    "token inválido",
    "no api key",
    "api key inválida",
    "api key no configurada",
    "permission",
    "permiso",
    "401",
    "403",
    "unauthorized",
    "forbidden",
    "no autorizado",
    "metaconnection caducada",
    "metaconnection no configurada",
    "ai key falta",
    "no hay api key",
    "rate limit",
    "quota exceeded",
    "cuota agotada"
  ];
  for (const p of credentialPatterns) {
    if (m.includes(p)) return "credential";
  }
  return "technical";
}
