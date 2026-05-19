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
    // Guard de presupuesto: si el cliente/workspace agotó su tope
    // mensual, paramos antes de gastar tokens.
    try {
      const { checkBudgetBeforeRun } = await import("@/lib/ai/nv-ia/budget");
      const budget = await checkBudgetBeforeRun({
        workspaceId: run.workspaceId,
        taskId: run.taskId
      });
      if (!budget.ok) {
        await prisma.aiAgentRun.update({
          where: { id: runId },
          data: {
            status: "REQUIRES_HUMAN",
            error: budget.reason,
            summary: `Bloqueado por presupuesto. Aumenta el tope en Workspace.settings.aiAgent.monthlyBudgetUsd ${budget.scope === "client" ? "o Client.settings.aiAgent.monthlyBudgetUsd" : ""} para reanudar.`,
            finishedAt: new Date()
          }
        });
        return { skipped: false, runId, status: "REQUIRES_HUMAN" } as any;
      }
      if (budget.level === "warning") {
        console.warn(`[sonia budget] ${budget.reason}`);
      }
    } catch (budgetErr: any) {
      console.warn(`[sonia budget] check fallo, sigo sin guard:`, budgetErr?.message);
    }

    const config = await loadAgentConfig(run.workspaceId);

    // Multi-LLM routing opcional. Si Workspace.settings.aiAgent.modelRouting
    // está en "auto" o "cost_saver", aplicamos heurística al título +
    // descripción de la task y bajamos a Sonnet/Haiku cuando podemos —
    // ahorro 5-15× en tokens sin perder calidad en tareas simples.
    try {
      const ws = await prisma.workspace.findUnique({
        where: { id: run.workspaceId },
        select: { settings: true }
      });
      const routing = ((ws?.settings as any)?.aiAgent?.modelRouting ?? "always_opus") as
        | "always_opus"
        | "auto"
        | "cost_saver";
      if (routing !== "always_opus") {
        const t = await prisma.task.findFirst({
          where: { id: run.taskId, workspaceId: run.workspaceId },
          select: { title: true, description: true }
        });
        if (t) {
          const { pickModelForTask } = await import("@/lib/ai/nv-ia/model-router");
          const picked = pickModelForTask({
            routing,
            title: t.title,
            description: t.description,
            fallback: (config.model as any) ?? "claude-opus-4-7"
          });
          if (picked.model !== config.model) {
            console.log(
              `[sonia] modelRouting=${routing} → ${picked.model} (${picked.reason})`
            );
            config.model = picked.model;
            // Persistimos el modelo elegido en el run para que se vea
            // en el dashboard y en el replay.
            await prisma.aiAgentRun.update({
              where: { id: runId },
              data: { model: picked.model }
            });
          }
        }
      }
    } catch (routerErr: any) {
      console.warn(`[sonia] modelRouting fallback (no aplicado):`, routerErr?.message);
    }

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
    const errorClass = classifyError(result.error ?? "");
    // Transient (529/503/etc): NO escalamos a Claude. La task queda
    // FAILED y el user puede reintentar manualmente con "Pedir a Sonia"
    // dentro de unos minutos cuando Anthropic respire. Antes
    // escalábamos cualquier "technical" → bucle de issues vacíos en
    // GitHub por cada saturación de Anthropic.
    if (result.status === "FAILED" && errorClass === "technical") {
      finalStatus = "REQUIRES_HUMAN" as any;
      const explainer =
        `❓ Me he topado con un problema técnico y he abierto un issue en GitHub con el contexto entero para que Claude Code lo arregle.\n\n` +
        `**Error:** ${(result.error ?? "(sin detalle)").slice(0, 400)}\n\n` +
        `**Qué hago yo ahora:** nada — la tarea queda parada. Claude Code revisa el issue cuando alguien con acceso al repo le da paso. Cuando el fix esté desplegado, **vuelve a pulsar "Pedir a Sonia"** en esta tarea para relanzarla con el código nuevo. Antes decía "re-procesa automáticamente" pero no es cierto y solo generaba confusión.\n\n` +
        `Si llevas un rato esperando y la situación es bloqueante, pega el texto del error en un mensaje a David y él decide.`;
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
    // SOLO para errores técnicos (bugs reales del runner/tools). Los
    // transient (Anthropic 529/503 etc.) NO escalan — solo deja
    // FAILED y comentario explicativo al user. Los credential
    // tampoco — los arregla el user, no Claude.
    if (
      (finalStatus === "FAILED" || finalStatus === "REQUIRES_HUMAN") &&
      errorClass === "technical"
    ) {
      // PRIMERO intentamos auto-fix via agente Claude programático.
      // Si las env GITHUB_SELF_HEAL_* están seteadas, lanzamos la
      // función que lee el código del repo, propone un patch, abre PR
      // y opcionalmente la mergea automáticamente. Sin intervención
      // humana de ningún tipo.
      // Si self-heal no está configurado o falla, caemos al modo
      // anterior (issue manual en GitHub con @claude mention).
      const hasSelfHeal =
        !!process.env.GITHUB_SELF_HEAL_TOKEN && !!process.env.GITHUB_SELF_HEAL_REPO;
      if (hasSelfHeal) {
        void (async () => {
          try {
            const { attemptSelfHeal } = await import("@/lib/ai/self-heal/agent");
            const log = Array.isArray(run.log) ? (run.log as any[]) : [];
            const logTail = log
              .slice(-12)
              .map((s: any) => {
                if (s.type === "tool_use")
                  return `→ tool: ${s.tool}(${JSON.stringify(s.input).slice(0, 200)})`;
                if (s.type === "tool_result")
                  return `  result: ${JSON.stringify(s.output).slice(0, 200)}`;
                if (s.type === "text") return `Sonia: ${String(s.text).slice(0, 300)}`;
                if (s.type === "error") return `ERROR: ${s.message}`;
                return `${s.type}`;
              })
              .join("\n");
            const t = await prisma.task.findUnique({
              where: { id: run.taskId },
              select: { title: true, description: true }
            });
            const r = await attemptSelfHeal({
              workspaceId: run.workspaceId,
              runId,
              errorMsg: result.error ?? "(sin detalle)",
              taskTitle: t?.title ?? "",
              taskDescription: t?.description,
              runLogTail: logTail
            });
            if (r.ok) {
              console.log(
                `[self-heal] OK runId=${runId} PR=${r.prUrl} merged=${r.merged} files=${r.filesChanged?.join(",")}`
              );
            } else {
              console.warn(`[self-heal] sin patch runId=${runId}: ${r.error}`);
            }
            // Comentario en la task explicando qué hizo el agente
            const ws = await prisma.workspace.findUnique({
              where: { id: run.workspaceId },
              select: { settings: true }
            });
            const aiUserId = (ws?.settings as any)?.aiAgent?.userId;
            if (aiUserId) {
              let body: string;
              if (r.ok && r.merged) {
                body =
                  `🤖 **Auto-fix aplicado y mergeado a la branch principal.**\n\n` +
                  `PR: ${r.prUrl}\n` +
                  `Archivos cambiados: ${(r.filesChanged ?? []).map((f) => `\`${f}\``).join(", ")}\n\n` +
                  `Cuando Railway termine de deployar (~3-5 min), la tarea se relanzará automáticamente.`;
              } else if (r.ok && !r.merged) {
                body =
                  `🤖 **Auto-fix propuesto, PR abierta (sin auto-merge).**\n\n` +
                  `PR: ${r.prUrl}\n` +
                  `El agente consideró el cambio no trivial y dejó la PR para revisión.\n` +
                  `Tras mergear manual, vuelve a pulsar "Pedir a Sonia".`;
              } else {
                body =
                  `🤖 **Auto-fix intentado pero sin éxito.**\n\n` +
                  `Motivo: ${r.error ?? "(sin detalle)"}\n\n` +
                  (r.agentReasoning
                    ? `**Diagnóstico:**\n>${r.agentReasoning.slice(0, 1200).replace(/\n/g, "\n>")}\n\n`
                    : "") +
                  `Voy a crear el issue de respaldo en GitHub por si quieres mirarlo.`;
              }
              await prisma.comment.create({
                data: {
                  workspaceId: run.workspaceId,
                  authorId: aiUserId,
                  targetType: "TASK",
                  targetId: run.taskId,
                  body
                }
              });
            }
            // Si el self-heal mergea: programa el relanzamiento de la
            // task en T+5min (cuando Railway debería haber deployado).
            if (r.ok && r.merged) {
              setTimeout(
                () => {
                  void (async () => {
                    try {
                      const fresh = await prisma.aiAgentRun.create({
                        data: {
                          workspaceId: run.workspaceId,
                          taskId: run.taskId,
                          status: "PENDING",
                          trigger: "SCHEDULED" as any,
                          triggerContext: `Relanzamiento post auto-fix (PR ${r.prUrl}).`
                        }
                      });
                      const { processRunInBackground } = await import("./process-run");
                      processRunInBackground(fresh.id);
                    } catch (e: any) {
                      console.warn(`[self-heal] relanzamiento fallo:`, e?.message);
                    }
                  })();
                },
                5 * 60_000
              ).unref?.();
            }
          } catch (e: any) {
            console.warn(`[self-heal] crash runId=${runId}:`, e?.message);
          }
          // Tras self-heal (haya OK o no), seguimos con el escalate a
          // GitHub issue COMO RESPALDO — así queda registro humano
          // independientemente del éxito automático.
          void escalateRunToGitHub(runId).catch(() => {});
        })();
      } else {
        // Self-heal no configurado → solo escalate manual a GitHub.
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
    }

    // Comentario explicativo si es transient: avisamos al user que es
    // saturación temporal de Anthropic, NO un bug, y que puede
    // reintentar en unos minutos.
    if (finalStatus === "FAILED" && errorClass === "transient") {
      try {
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
              body:
                "⏳ La IA de Anthropic está temporalmente saturada (error transitorio). " +
                "NO es un bug del sistema — su infra está sobrecargada. " +
                "Vuelve a pulsar **Pedir a Sonia** en unos 2-5 minutos y debería funcionar.\n\n" +
                "Detalle técnico: " +
                (result.error ?? "").slice(0, 200)
            }
          });
        }
      } catch {}
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
function classifyError(errorMsg: string): "credential" | "transient" | "technical" {
  const m = errorMsg.toLowerCase();
  // Errores TRANSIENTES de infra de Anthropic / red. No son bugs nuestros
  // ni del workspace — son momentáneos. Si llegan aquí significa que el
  // retry interno ya falló N veces; el run queda FAILED pero NO escalamos
  // a Claude Code (no hay nada que arreglar). El user puede reintentar
  // manualmente en unos minutos.
  const transientPatterns = [
    "overloaded",
    "529",
    "502",
    "503",
    "504",
    "gateway timeout",
    "service unavailable",
    "etimedout",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "fetch failed",
    "network error",
    "anthropic api timeout"
  ];
  for (const p of transientPatterns) {
    if (m.includes(p)) return "transient";
  }
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
