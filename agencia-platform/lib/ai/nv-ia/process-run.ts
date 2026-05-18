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

    return { runId, status: result.status, steps: result.stepsCount };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    await prisma.aiAgentRun
      .update({
        where: { id: runId },
        data: { status: "FAILED", error: msg, finishedAt: new Date() }
      })
      .catch(() => {});
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
  void processOneRun(runId).catch((e) => {
    console.error("[sonia] background processRun fail:", runId, e?.message ?? e);
  });
}
