/**
 * Worker durable del orquestador (G2) — recuperación tras reinicio + reanudación.
 *
 * El estado vive en la BD (state/version/usage/fingerprints/strategy/plan/nextRunAt),
 * así que un proceso que se cae no pierde nada: OTRO worker (o el mismo tras reiniciar)
 * re-lease las orquestaciones no terminales cuyo lease haya expirado y las avanza un
 * paso. `nextRunAt` gobierna waiting_backoff; `approval_required` se reanuda cuando
 * llega una aprobación (se pone nextRunAt al presente). Puro/inyectable → testeable
 * con prisma mock, sin red ni scheduler real.
 */
import { isTerminal, type OrchState } from "./state-machine";
import { transition, type Orchestration } from "./store";

type PrismaLike = any;

/** Estados no terminales que un worker puede tomar para avanzar. */
export const RESUMABLE_STATES: OrchState[] = ["queued", "planning", "executing", "verifying", "diagnosing", "decomposing", "waiting_backoff", "approval_required"];

/**
 * Reclama hasta `limit` orquestaciones pendientes de trabajo: no terminales, con
 * nextRunAt vencido (o null) y SIN lease vivo. El claim es una escritura guardada
 * por versión (optimista) → dos workers no toman la misma fila. Devuelve las filas
 * reclamadas (ya con lease). Recuperación tras reinicio = un lease expirado se re-toma.
 */
export async function claimDue(
  prisma: PrismaLike,
  args: { owner: string; now: Date; leaseMs: number; limit?: number }
): Promise<Orchestration[]> {
  const candidates: Orchestration[] = await prisma.aiOrchestration.findMany({
    where: {
      state: { in: RESUMABLE_STATES },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: args.now } }],
      AND: [{ OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: args.now } }] }]
    },
    orderBy: { nextRunAt: "asc" },
    take: args.limit ?? 10
  });
  const leaseUntil = new Date(args.now.getTime() + args.leaseMs);
  const claimed: Orchestration[] = [];
  for (const c of candidates) {
    // Claim guardado por versión: si otro worker ya lo movió, count=0 y lo saltamos.
    const res = await prisma.aiOrchestration.updateMany({
      where: { id: c.id, workspaceId: c.workspaceId, version: c.version, leaseOwner: c.leaseOwner ?? null },
      data: { leaseOwner: args.owner, leaseExpiresAt: leaseUntil, version: c.version + 1 }
    });
    if (res.count === 1) claimed.push({ ...c, version: c.version + 1, leaseOwner: args.owner });
  }
  return claimed;
}

/** Reconstruye el contexto de recuperación desde la fila persistida (resume). */
export function resumeContext(orch: Orchestration): { usage: any; fingerprints: string[]; strategyLabel: string | null } {
  const usage = orch.usage ?? { attempts: 0, elapsedMs: 0, tokens: 0, costUsd: 0 };
  const fingerprints = Array.isArray(orch.fingerprints) ? (orch.fingerprints as string[]) : [];
  return { usage, fingerprints, strategyLabel: orch.strategy ?? null };
}

/** Libera el lease de una orquestación (al terminar el paso o al soltarla). */
export async function releaseLease(prisma: PrismaLike, orch: { id: string; workspaceId: string }): Promise<void> {
  await prisma.aiOrchestration.updateMany({
    where: { id: orch.id, workspaceId: orch.workspaceId },
    data: { leaseOwner: null, leaseExpiresAt: null }
  });
}

/**
 * Marca una orquestación en `approval_required` como reanudable AHORA (cuando llega la
 * aprobación): pone nextRunAt al presente para que el poller la recoja. Tenant-scoped.
 */
export async function resumeAfterApproval(prisma: PrismaLike, args: { id: string; workspaceId: string; now: Date }): Promise<{ ok: boolean }> {
  const res = await prisma.aiOrchestration.updateMany({
    where: { id: args.id, workspaceId: args.workspaceId, state: "approval_required" },
    data: { nextRunAt: args.now }
  });
  return { ok: res.count === 1 };
}

/**
 * Avanza UNA orquestación un paso. `deps.runStep` es la función que, dado el estado
 * actual, produce la siguiente transición (usa el controller/adapters/deadline). El
 * worker la aplica con `transition` (concurrency-safe) y libera/re-lease. Kill-switch
 * inyectado: si activo, transiciona a `cancelled`. Devuelve el nuevo estado.
 */
export async function stepOrchestration(
  prisma: PrismaLike,
  deps: {
    runStep: (orch: Orchestration) => Promise<{ to: OrchState; patch?: any }>;
    killSwitch?: () => boolean;
  },
  orch: Orchestration
): Promise<{ ok: boolean; to?: OrchState; reason?: string }> {
  if (isTerminal(orch.state)) return { ok: false, reason: "terminal" };

  let next: { to: OrchState; patch?: any };
  if (deps.killSwitch?.()) {
    next = { to: "cancelled", patch: { lastError: "kill-switch" } };
  } else {
    next = await deps.runStep(orch);
  }

  const res = await transition(prisma, {
    id: orch.id,
    workspaceId: orch.workspaceId,
    from: orch.state,
    to: next.to,
    expectedVersion: orch.version,
    patch: next.patch
  });
  // Al terminar el paso, si el estado es terminal soltamos el lease del todo.
  if (isTerminal(next.to)) await releaseLease(prisma, orch);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, to: next.to };
}
