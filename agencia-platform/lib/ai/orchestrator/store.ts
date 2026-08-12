/**
 * Persistencia del orquestador (Slice 2c). Transiciones VALIDADAS + concurrency
 * -safe (optimistic version), tenant-scoped (SIEMPRE workspaceId) e idempotentes.
 * Log de pasos APPEND-ONLY. No ejecuta nada externo.
 */
import { canTransition, isOrchState, type OrchState } from "./state-machine";
import type { ApprovalRecord } from "./approvals";

type PrismaLike = any;

export type Orchestration = {
  id: string;
  workspaceId: string;
  taskId: string;
  runId: string | null;
  state: OrchState;
  version: number;
  mode: string;
  strategy: string | null;
  plan: any;
  limits: any;
  usage: any;
  fingerprints: any;
  decision: any;
  lastError: string | null;
  nextRunAt: Date | null;
};

/**
 * Crea (o recupera) la orquestación de una tarea. IDEMPOTENTE por
 * @@unique([workspaceId, taskId]): dos llamadas concurrentes no crean dos filas.
 */
export async function ensureOrchestration(
  prisma: PrismaLike,
  args: { workspaceId: string; taskId: string; runId?: string | null; limits?: any; mode?: "shadow" | "live" }
): Promise<Orchestration> {
  const { workspaceId, taskId } = args;
  try {
    return (await prisma.aiOrchestration.create({
      data: {
        workspaceId,
        taskId,
        runId: args.runId ?? null,
        state: "queued",
        version: 0,
        mode: args.mode ?? "shadow",
        limits: args.limits ?? null,
        usage: { attempts: 0, elapsedMs: 0, tokens: 0, costUsd: 0 },
        fingerprints: []
      }
    })) as Orchestration;
  } catch (e: any) {
    if (e?.code === "P2002") {
      const existing = await prisma.aiOrchestration.findFirst({ where: { workspaceId, taskId } });
      if (existing) return existing as Orchestration;
    }
    throw e;
  }
}

export async function getOrchestration(prisma: PrismaLike, workspaceId: string, id: string): Promise<Orchestration | null> {
  return (await prisma.aiOrchestration.findFirst({ where: { id, workspaceId } })) as Orchestration | null;
}

export type TransitionResult =
  | { ok: true; state: OrchState; version: number }
  | { ok: false; reason: "invalid" | "stale" | "not_found"; from: OrchState; to: OrchState };

/**
 * Aplica una transición. Rechaza transiciones inválidas ANTES de tocar la BD.
 * En BD usa updateMany con { id, workspaceId, version, state } → si otro proceso
 * ya movió la fila, count=0 (stale, no se pisa). Tenant-scoped por `workspaceId`.
 */
export async function transition(
  prisma: PrismaLike,
  args: {
    id: string;
    workspaceId: string;
    from: OrchState;
    to: OrchState;
    expectedVersion: number;
    patch?: Partial<Record<"strategy" | "plan" | "usage" | "fingerprints" | "decision" | "lastError" | "nextRunAt" | "runId", any>>;
  }
): Promise<TransitionResult> {
  const { id, workspaceId, from, to, expectedVersion } = args;
  if (!isOrchState(from) || !isOrchState(to) || !canTransition(from, to)) {
    return { ok: false, reason: "invalid", from, to };
  }
  const res = await prisma.aiOrchestration.updateMany({
    where: { id, workspaceId, version: expectedVersion, state: from },
    // `patch` PRIMERO → `state`/`version` autoritativos SIEMPRE ganan (un patch
    // con esas claves no puede sobrescribir la transición ni el contador).
    data: { ...(args.patch ?? {}), state: to, version: expectedVersion + 1 }
  });
  if (res.count === 1) return { ok: true, state: to, version: expectedVersion + 1 };
  // No aplicó: ¿existe? ¿ya estaba en otro estado/versión?
  const cur = await prisma.aiOrchestration.findFirst({ where: { id, workspaceId }, select: { id: true } });
  return { ok: false, reason: cur ? "stale" : "not_found", from, to };
}

/** Añade un paso al log append-only. `seq` se calcula de forma monótona. */
export async function appendStep(
  prisma: PrismaLike,
  args: {
    workspaceId: string;
    orchestrationId: string;
    phase: string;
    strategy?: string | null;
    provider?: string | null;
    model?: string | null;
    ok?: boolean | null;
    diagnosis?: string | null;
    costUsd?: number | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    fingerprint?: string | null;
    error?: string | null;
    evidence?: any;
  }
): Promise<{ seq: number }> {
  const last = await prisma.aiRunStep.findFirst({
    where: { workspaceId: args.workspaceId, orchestrationId: args.orchestrationId },
    orderBy: { seq: "desc" },
    select: { seq: true }
  });
  // Reintenta ante colisión de seq (@@unique) por appends concurrentes → el log
  // append-only es realmente monótono y sin duplicados.
  let seq = (last?.seq ?? -1) + 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await prisma.aiRunStep.create({
        data: {
          workspaceId: args.workspaceId,
          orchestrationId: args.orchestrationId,
          seq,
          phase: args.phase,
          strategy: args.strategy ?? null,
          provider: args.provider ?? null,
          model: args.model ?? null,
          ok: args.ok ?? null,
          diagnosis: args.diagnosis ?? null,
          costUsd: args.costUsd ?? null,
          tokensIn: args.tokensIn ?? null,
          tokensOut: args.tokensOut ?? null,
          fingerprint: args.fingerprint ?? null,
          error: args.error ?? null,
          evidence: args.evidence ?? null
        }
      });
      return { seq };
    } catch (e: any) {
      if (e?.code === "P2002") {
        seq++; // otro append tomó este seq → siguiente
        continue;
      }
      throw e;
    }
  }
  return { seq };
}

/** Aprobaciones VIVAS del workspace (para el cableado de autonomía en shadow). */
export async function liveApprovals(prisma: PrismaLike, workspaceId: string, now: Date): Promise<ApprovalRecord[]> {
  const rows = await prisma.aiApproval.findMany({
    where: { workspaceId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { id: true, action: true, scope: true, maxAmountCents: true, maxVolume: true, remaining: true, expiresAt: true, revokedAt: true }
  });
  return rows as ApprovalRecord[];
}
