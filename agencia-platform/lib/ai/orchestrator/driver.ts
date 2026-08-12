/**
 * Driver del simulador SHADOW (Slice 2c.3). Persiste una simulación del bucle de
 * recuperación como una orquestación + pasos (append-only) para que el panel API
 * la muestre. NO ejecuta nada real; el estado final es el que calculó el simulador
 * puro. Tenant-scoped. Idempotente por tarea (ensureOrchestration).
 */
import { ensureOrchestration, appendStep } from "./store";
import { simulateRun, type AttemptOutcome, type SimConfig, type SimResult } from "./simulate";

type PrismaLike = any;

/** Ejecuta el simulador puro y PERSISTE la traza (orquestación + pasos). Shadow. */
export async function runAndPersistSimulation(
  prisma: PrismaLike,
  args: { workspaceId: string; taskId: string; createdById?: string | null; scenario: AttemptOutcome[]; config?: SimConfig }
): Promise<{ orchestrationId: string; result: SimResult }> {
  const result = simulateRun(args.scenario, args.config ?? {});
  const orch = await ensureOrchestration(prisma, { workspaceId: args.workspaceId, taskId: args.taskId, mode: "shadow" });

  for (const step of result.steps) {
    await appendStep(prisma, {
      workspaceId: args.workspaceId,
      orchestrationId: orch.id,
      phase: step.phase,
      strategy: step.strategy ?? null,
      provider: step.provider ?? null,
      ok: step.ok ?? null,
      diagnosis: step.diagnosis ?? null,
      costUsd: step.costUsd ?? null,
      fingerprint: null
    });
  }

  // Estado final + uso + decision packet (registro shadow; scoped por workspace).
  await prisma.aiOrchestration.updateMany({
    where: { id: orch.id, workspaceId: args.workspaceId },
    data: { state: result.finalState, mode: "shadow", usage: result.usage as any, decision: (result.decision ?? null) as any, strategy: null }
  });

  return { orchestrationId: orch.id, result };
}
