/**
 * Driver del simulador SHADOW (Slice 2c.3). Persiste una simulación del bucle de
 * recuperación como una orquestación + pasos (append-only) para que el panel API
 * la muestre. NO ejecuta nada real; el estado final es el que calculó el simulador
 * puro. Tenant-scoped. Idempotente por tarea (ensureOrchestration).
 *
 * AISLAMIENTO (F1): una simulación NUNCA reutiliza la fila de una ejecución real.
 * La clave única de orquestación es (workspaceId, taskId); para no pisar un run real
 * (presente o futuro `mode:"live"`) namespaced el taskId con `sim:`. Además, cada
 * re-simulación del mismo `sim:` descarta su traza previa → sin logs concatenados ni
 * estados que oscilan. El prefijo es un espacio propio de simulaciones, no un run.
 */
import { ensureOrchestration, appendStep } from "./store";
import { simulateRun, type AttemptOutcome, type SimConfig, type SimResult } from "./simulate";

type PrismaLike = any;

/** Prefijo del espacio de simulaciones (aislado de las orquestaciones reales). */
export const SIM_TASK_PREFIX = "sim:";

/** Ejecuta el simulador puro y PERSISTE la traza (orquestación + pasos). Shadow. */
export async function runAndPersistSimulation(
  prisma: PrismaLike,
  args: { workspaceId: string; taskId: string; createdById?: string | null; scenario: AttemptOutcome[]; config?: SimConfig }
): Promise<{ orchestrationId: string; result: SimResult; persistedSteps: number }> {
  const result = simulateRun(args.scenario, args.config ?? {});
  // Namespace: jamás colisiona con la orquestación real de la misma tarea.
  const simTaskId = args.taskId.startsWith(SIM_TASK_PREFIX) ? args.taskId : `${SIM_TASK_PREFIX}${args.taskId}`;
  const orch = await ensureOrchestration(prisma, { workspaceId: args.workspaceId, taskId: simTaskId, mode: "shadow" });

  // Re-simulación LIMPIA: descarta la traza previa de ESTA simulación (tenant-scoped)
  // para que el panel muestre solo la corrida actual, sin concatenar.
  await prisma.aiRunStep.deleteMany({ where: { workspaceId: args.workspaceId, orchestrationId: orch.id } });

  let persistedSteps = 0;
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
    persistedSteps++;
  }

  // Estado final + uso + decision packet (registro shadow; scoped por workspace).
  const upd = await prisma.aiOrchestration.updateMany({
    where: { id: orch.id, workspaceId: args.workspaceId },
    data: { state: result.finalState, mode: "shadow", usage: result.usage as any, decision: (result.decision ?? null) as any, strategy: null }
  });
  // No falsear éxito: si la fila desapareció / no es del tenant, count=0 → error.
  if (!upd || upd.count !== 1) {
    throw new Error("La orquestación de simulación no se pudo actualizar (fila ausente o de otro workspace).");
  }

  return { orchestrationId: orch.id, result, persistedSteps };
}
