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
 * estados que oscilan.
 *
 * ATOMICIDAD (M2): delete+append+update van en UNA transacción interactiva. Al entrar
 * se "reclama" la fila con un update guardado por `version` (toma el row-lock de
 * Postgres) → dos re-simulaciones concurrentes de la misma tarea se SERIALIZAN: la
 * segunda ve la versión ya avanzada, su claim casa 0 filas y aborta (rollback), en
 * vez de intercalar pasos. Si algo lanza a mitad, la transacción revierte y la traza
 * previa se conserva (no destructivo-antes-de-durable).
 */
import { ensureOrchestration, appendStep } from "./store";
import { simulateRun, type AttemptOutcome, type SimConfig, type SimResult } from "./simulate";

type PrismaLike = any;

/** Prefijo del espacio de simulaciones (aislado de las orquestaciones reales). */
export const SIM_TASK_PREFIX = "sim:";

export class ConcurrentSimulationError extends Error {
  constructor(msg = "Simulación concurrente para la misma tarea; reintenta.") {
    super(msg);
    this.name = "ConcurrentSimulationError";
  }
}

/** Ejecuta el simulador puro y PERSISTE la traza (orquestación + pasos). Shadow. */
export async function runAndPersistSimulation(
  prisma: PrismaLike,
  args: { workspaceId: string; taskId: string; createdById?: string | null; scenario: AttemptOutcome[]; config?: SimConfig }
): Promise<{ orchestrationId: string; result: SimResult; persistedSteps: number }> {
  const result = simulateRun(args.scenario, args.config ?? {});
  // Namespace: jamás colisiona con la orquestación real de la misma tarea.
  const simTaskId = args.taskId.startsWith(SIM_TASK_PREFIX) ? args.taskId : `${SIM_TASK_PREFIX}${args.taskId}`;
  const orch = await ensureOrchestration(prisma, { workspaceId: args.workspaceId, taskId: simTaskId, mode: "shadow", createdById: args.createdById ?? null });
  const baseVersion = typeof orch.version === "number" ? orch.version : 0;

  const persistedSteps = await prisma.$transaction(async (tx: PrismaLike) => {
    // 1) Reclamo con guard de versión → row-lock + serialización de concurrentes.
    const claim = await tx.aiOrchestration.updateMany({
      where: { id: orch.id, workspaceId: args.workspaceId, version: baseVersion },
      data: { version: baseVersion + 1 }
    });
    if (!claim || claim.count !== 1) throw new ConcurrentSimulationError();

    // 2) Re-simulación LIMPIA: descarta la traza previa de ESTA simulación.
    await tx.aiRunStep.deleteMany({ where: { workspaceId: args.workspaceId, orchestrationId: orch.id } });

    // 3) Re-escribe la traza (append-only, seq desde 0).
    let n = 0;
    for (const step of result.steps) {
      await appendStep(tx, {
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
      n++;
    }

    // 4) Estado final + uso + decision packet, guardado por la versión reclamada.
    const upd = await tx.aiOrchestration.updateMany({
      where: { id: orch.id, workspaceId: args.workspaceId, version: baseVersion + 1 },
      data: { state: result.finalState, mode: "shadow", usage: result.usage as any, decision: (result.decision ?? null) as any, strategy: null, version: baseVersion + 2 }
    });
    if (!upd || upd.count !== 1) throw new ConcurrentSimulationError();

    return n;
  });

  return { orchestrationId: orch.id, result, persistedSteps };
}
