/**
 * Persistencia del orquestador (Slice 2c). Transiciones VALIDADAS + concurrency
 * -safe (optimistic version), tenant-scoped (SIEMPRE workspaceId) e idempotentes.
 * Log de pasos APPEND-ONLY. No ejecuta nada externo.
 */
import { canTransition, isOrchState, type OrchState } from "./state-machine";
import type { ApprovalRecord } from "./approvals";
import { redactPii } from "./pii-redact";

type PrismaLike = any;

/** Redacción ESTRUCTURAL en la frontera de persistencia: cualquier texto crudo que
 *  llegue a un paso (error de proveedor, evidencia) se saneade PII ANTES de escribir,
 *  para que ni el log append-only ni el panel puedan filtrar claves/emails/etc. */
function redactText(v: string | null | undefined): string | null {
  if (v == null) return null;
  return redactPii(v).text;
}
function redactEvidence(e: any): any {
  if (e == null) return null;
  if (typeof e === "string") return redactPii(e).text;
  if (Array.isArray(e)) return e.map(redactEvidence);
  if (typeof e === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(e)) out[k] = redactEvidence(val);
    return out;
  }
  return e;
}

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
  leaseOwner?: string | null;
  leaseExpiresAt?: Date | null;
};

/**
 * Crea (o recupera) la orquestación de una tarea. IDEMPOTENTE por
 * @@unique([workspaceId, taskId]): dos llamadas concurrentes no crean dos filas.
 */
export async function ensureOrchestration(
  prisma: PrismaLike,
  args: { workspaceId: string; taskId: string; runId?: string | null; limits?: any; mode?: "shadow" | "live"; createdById?: string | null }
): Promise<Orchestration> {
  const { workspaceId, taskId } = args;
  try {
    return (await prisma.aiOrchestration.create({
      data: {
        workspaceId,
        taskId,
        runId: args.runId ?? null,
        createdById: args.createdById ?? null,
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

/**
 * Encola una orquestación LIVE (A0/A1) lista para que el scheduler la procese en el
 * próximo tick. A diferencia de `ensureOrchestration` (que solo crea el esqueleto en
 * shadow), fija `mode:"live"`, el `plan` YA validado/saneado por el endpoint, los
 * `limits` acotados y `nextRunAt=now` (due inmediatamente). IDEMPOTENTE por
 * @@unique([workspaceId, taskId]): reintentos/carreras con el mismo `taskId` NO crean
 * una segunda fila — se devuelve la existente con `created:false` (sin pisar su plan).
 * Tenant-scoped: el `workspaceId` lo fija SIEMPRE el servidor.
 */
export async function enqueueLiveOrchestration(
  prisma: PrismaLike,
  args: { workspaceId: string; taskId: string; createdById?: string | null; plan: any; limits: any; now: Date }
): Promise<{ orchestration: Orchestration; created: boolean }> {
  const { workspaceId, taskId } = args;
  try {
    const created = (await prisma.aiOrchestration.create({
      data: {
        workspaceId,
        taskId,
        createdById: args.createdById ?? null,
        state: "queued",
        version: 0,
        mode: "live",
        plan: args.plan,
        limits: args.limits,
        usage: { attempts: 0, elapsedMs: 0, tokens: 0, costUsd: 0 },
        fingerprints: [],
        nextRunAt: args.now
      }
    })) as Orchestration;
    return { orchestration: created, created: true };
  } catch (e: any) {
    if (e?.code === "P2002") {
      const existing = await prisma.aiOrchestration.findFirst({ where: { workspaceId, taskId } });
      if (existing) return { orchestration: existing as Orchestration, created: false };
    }
    throw e;
  }
}

/** Cuenta orquestaciones NO terminales (aún vivas) del workspace — para el tope de
 *  concurrencia por tenant del enqueuer (evita inundar el scheduler). Tenant-scoped. Si se
 *  aporta `mode`, solo cuenta ese modo (p.ej. "live") → el tope live no lo consume el shadow. */
export async function countActiveOrchestrations(prisma: PrismaLike, workspaceId: string, activeStates: string[], mode?: string): Promise<number> {
  return (await prisma.aiOrchestration.count({ where: { workspaceId, state: { in: activeStates }, ...(mode ? { mode } : {}) } })) as number;
}

export async function getOrchestration(prisma: PrismaLike, workspaceId: string, id: string): Promise<Orchestration | null> {
  return (await prisma.aiOrchestration.findFirst({ where: { id, workspaceId } })) as Orchestration | null;
}

/** Columnas de AiOrchestration que un `patch` de transición puede escribir. Cualquier
 *  otra clave se DESCARTA (fail-safe): así una clave ajena nunca dispara un
 *  PrismaClientValidationError que dejaría el run atascado a mitad de un paso. */
const TRANSITION_PATCH_FIELDS = new Set([
  "strategy",
  "plan",
  "usage",
  "limits",
  "fingerprints",
  "decision",
  "lastError",
  "nextRunAt",
  "runId"
]);

function sanitizePatch(patch: any): Record<string, unknown> {
  if (patch == null || typeof patch !== "object") return {};
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (TRANSITION_PATCH_FIELDS.has(k)) out[k] = v;
    else dropped.push(k);
  }
  // Observabilidad sin PII: solo los NOMBRES de campo descartados (nunca los valores),
  // para detectar en logs un patch mal formado sin filtrar contenido.
  if (dropped.length > 0) {
    console.warn(`[ai-store] transition patch: claves no reconocidas descartadas: ${dropped.join(",")}`);
  }
  return out;
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
    patch?: Partial<Record<"strategy" | "plan" | "usage" | "limits" | "fingerprints" | "decision" | "lastError" | "nextRunAt" | "runId", any>>;
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
    // FAIL-SAFE: se filtra a las columnas conocidas de AiOrchestration. Una clave
    // ajena en el patch (p.ej. `provider`, que NO es columna) haría que Prisma lanzara
    // PrismaClientValidationError y dejaría el run atascado; descartarla evita ese
    // fallo parcial por completo (el paso siempre puede aplicar la transición).
    data: { ...sanitizePatch(args.patch), state: to, version: expectedVersion + 1 }
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
  const MAX_TRIES = 8;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
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
          // Redacción estructural: nunca se persiste texto crudo sin sanear.
          error: redactText(args.error),
          evidence: redactEvidence(args.evidence)
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
  // FAIL-LOUD (M1): agotados los reintentos NO devolvemos un seq fabricado (sería un
  // falso éxito: el caller contaría un paso que no existe). Lanzamos para que el
  // llamante lo trate como fallo real de persistencia.
  throw new Error(`appendStep: no se pudo asignar seq único tras ${MAX_TRIES} intentos (orchestrationId=${args.orchestrationId})`);
}

/** Aprobaciones VIVAS del workspace (para el cableado de autonomía en shadow). */
export async function liveApprovals(prisma: PrismaLike, workspaceId: string, now: Date): Promise<ApprovalRecord[]> {
  const rows = await prisma.aiApproval.findMany({
    where: { workspaceId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { id: true, action: true, scope: true, sensitive: true, maxAmountCents: true, maxVolume: true, remaining: true, expiresAt: true, revokedAt: true }
  });
  return rows as ApprovalRecord[];
}

/** Concede una aprobación + registra el evento de auditoría INMUTABLE, atómicamente.
 *  Tenant-scoped. El validador (validateApprovalGrant) se aplica ANTES en el endpoint. */
export async function grantApproval(
  prisma: PrismaLike,
  args: { workspaceId: string; action: string; scope?: string | null; sensitive?: boolean; maxAmountCents?: number | null; maxVolume?: number | null; remaining?: number | null; expiresAt: Date; grantedById?: string | null; reason: string }
): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx: PrismaLike) => {
    const appr = await tx.aiApproval.create({
      data: {
        workspaceId: args.workspaceId,
        action: args.action,
        scope: args.scope ?? null,
        sensitive: !!args.sensitive,
        maxAmountCents: args.maxAmountCents ?? null,
        maxVolume: args.maxVolume ?? null,
        remaining: args.remaining ?? null,
        expiresAt: args.expiresAt,
        grantedById: args.grantedById ?? null,
        reason: args.reason
      }
    });
    await tx.aiApprovalEvent.create({
      data: {
        workspaceId: args.workspaceId,
        approvalId: appr.id,
        event: "granted",
        actorId: args.grantedById ?? null,
        reason: args.reason,
        snapshot: { action: args.action, scope: args.scope ?? null, sensitive: !!args.sensitive, maxAmountCents: args.maxAmountCents ?? null, maxVolume: args.maxVolume ?? null, expiresAt: args.expiresAt.toISOString() }
      }
    });
    return { id: appr.id };
  });
}

/** Revoca una aprobación (idempotente) + evento de auditoría. Tenant-scoped. */
export async function revokeApproval(
  prisma: PrismaLike,
  args: { workspaceId: string; approvalId: string; revokedById?: string | null; reason?: string | null; now: Date }
): Promise<{ ok: boolean }> {
  return await prisma.$transaction(async (tx: PrismaLike) => {
    const upd = await tx.aiApproval.updateMany({
      where: { id: args.approvalId, workspaceId: args.workspaceId, revokedAt: null },
      data: { revokedAt: args.now, revokedById: args.revokedById ?? null }
    });
    if (upd.count !== 1) return { ok: false }; // no existe / ya revocada / otro tenant
    await tx.aiApprovalEvent.create({
      data: { workspaceId: args.workspaceId, approvalId: args.approvalId, event: "revoked", actorId: args.revokedById ?? null, reason: args.reason ?? null }
    });
    return { ok: true };
  });
}
