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

/** Estados que el poller toma para avanzar. `approval_required` NO está: un run
 *  parado esperando aprobación solo se reanuda con una acción explícita
 *  (`resumeAfterApproval`, que lo transiciona a `executing`), nunca en automático. */
export const RESUMABLE_STATES: OrchState[] = ["queued", "planning", "executing", "verifying", "diagnosing", "decomposing", "waiting_backoff"];

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

/**
 * Libera el lease SOLO si seguimos siendo el dueño (`leaseOwner`). Guard imprescindible:
 * si nuestro lease expiró y OTRO worker re-tomó la fila, no debemos borrar SU lease
 * (si lo hiciéramos, un tercer worker la tomaría en paralelo → doble procesamiento).
 */
export async function releaseLease(prisma: PrismaLike, orch: { id: string; workspaceId: string; leaseOwner?: string | null }): Promise<{ released: boolean }> {
  const res = await prisma.aiOrchestration.updateMany({
    where: { id: orch.id, workspaceId: orch.workspaceId, leaseOwner: orch.leaseOwner ?? null },
    data: { leaseOwner: null, leaseExpiresAt: null }
  });
  return { released: res.count === 1 };
}

/**
 * Reanuda un run parado en `approval_required` tras conceder la aprobación: lo
 * transiciona a `executing` (concurrency-safe) y lo hace due (nextRunAt=now) para que
 * el poller lo recoja. Tenant-scoped. Solo aplica si sigue en approval_required.
 */
export async function resumeAfterApproval(prisma: PrismaLike, args: { id: string; workspaceId: string; now: Date }): Promise<{ ok: boolean }> {
  const cur = await prisma.aiOrchestration.findFirst({ where: { id: args.id, workspaceId: args.workspaceId }, select: { version: true, state: true } });
  if (!cur || cur.state !== "approval_required") return { ok: false };
  const res = await transition(prisma, { id: args.id, workspaceId: args.workspaceId, from: "approval_required", to: "executing", expectedVersion: cur.version, patch: { nextRunAt: args.now } });
  return { ok: res.ok };
}

/** Estados donde el run PARA y suelta el lease hasta que vuelva a estar due o se
 *  reanude por aprobación (el poller lo re-toma cuando corresponda). */
export const PARKED_STATES: ReadonlySet<OrchState> = new Set<OrchState>(["waiting_backoff", "approval_required"]);

/**
 * Avanza UNA orquestación un paso. `deps.runStep` es la función que, dado el estado
 * actual, produce la siguiente transición (usa el controller/adapters/deadline). El
 * worker la aplica con `transition` (concurrency-safe) y libera/re-lease. Kill-switch
 * inyectado: si activo, transiciona a `cancelled`. Devuelve el nuevo estado.
 */
/** Tope de errores de paso CONSECUTIVOS antes de escalar a un estado terminal seguro. Un
 *  run que falla al calcular/aplicar su paso no debe repetir trabajo caro (p.ej. una llamada
 *  de modelo real) indefinidamente. El contador se resetea en cada paso exitoso. */
export const FAILSAFE_MAX_STEP_ERRORS = 3;

/** Si el run arrastraba errores de paso, los limpia del `plan` que se persistirá en la
 *  transición exitosa (contador CONSECUTIVO, no de por vida). Solo actúa si había errores
 *  (camino feliz intacto): devuelve el patch tal cual cuando no hay nada que limpiar. */
function clearStepErrorsOnSuccess(orch: Orchestration, patch: any): any {
  const prior = Number((orch.plan as any)?.stepErrors) || 0;
  if (prior <= 0) return patch;
  // Base = el plan que la transición iba a escribir (si lo trae) o el plan actual del run.
  const base =
    patch && typeof patch === "object" && patch.plan && typeof patch.plan === "object"
      ? patch.plan
      : orch.plan && typeof orch.plan === "object"
        ? orch.plan
        : {};
  const { stepErrors, lastStepError, ...rest } = base as any;
  return { ...(patch ?? {}), plan: rest };
}
/** Backoff entre reintentos fail-safe (difiere el próximo tick del run atascado). */
export const FAILSAFE_BACKOFF_MS = 60_000;

/**
 * RECUPERACIÓN FAIL-SAFE: una excepción al calcular `runStep` o al aplicar la transición
 * (p.ej. un error de validación de Prisma) NO debe dejar el run atascado repitiendo el
 * paso —y su coste— en cada tick. Cuenta el fallo de forma DURABLE (`plan.stepErrors`) con
 * una escritura guardada por versión+estado (solo si seguimos siendo dueños del paso) y:
 *   - difiere el próximo intento (`nextRunAt` = ahora + backoff) mientras no supere el tope;
 *   - al superar el tope, escala a `materially_blocked` (terminal seguro) y suelta el lease.
 * Nunca lanza: ante cualquier problema al persistir la recuperación, devuelve ok:false y el
 * lote sigue (el lease caducará y otro worker reintentará). Tenant-scoped.
 */
async function failSafeRecover(
  prisma: PrismaLike,
  orch: Orchestration,
  err: any,
  now: () => Date
): Promise<{ ok: boolean; to?: OrchState; reason?: string }> {
  const name = String(err?.name ?? "error");
  const plan = orch.plan && typeof orch.plan === "object" ? (orch.plan as any) : {};
  const stepErrors = (Number(plan.stepErrors) || 0) + 1;
  const escalate = stepErrors >= FAILSAFE_MAX_STEP_ERRORS;
  const data: Record<string, unknown> = {
    plan: { ...plan, stepErrors, lastStepError: name },
    lastError: name,
    version: orch.version + 1
  };
  if (escalate) {
    // Parada segura: `materially_blocked` es terminal y alcanzable desde cualquier no-terminal
    // (canTransition lo admite como escape fail-safe, igual que `cancelled`). Suelta el lease.
    data.state = "materially_blocked";
    data.nextRunAt = null;
    data.leaseOwner = null;
    data.leaseExpiresAt = null;
  } else {
    // Mismo estado, pero diferido: rompe el bucle "un tick = un intento caro fallido".
    data.nextRunAt = new Date(now().getTime() + FAILSAFE_BACKOFF_MS);
  }
  try {
    // Guardado por versión+estado: solo aplica si la fila sigue como la dejamos (somos
    // dueños del paso). Si otro worker la movió, count=0 → no pisamos nada.
    const res = await prisma.aiOrchestration.updateMany({
      where: { id: orch.id, workspaceId: orch.workspaceId, version: orch.version, state: orch.state },
      data
    });
    if (res.count !== 1) return { ok: false, reason: "stale" };
    return { ok: true, to: escalate ? "materially_blocked" : orch.state, reason: escalate ? "failsafe_blocked" : "failsafe_backoff" };
  } catch (e2: any) {
    console.warn(`[ai-scheduler] failSafeRecover ${orch.id} no pudo persistir: ${String(e2?.name ?? "error")}`);
    return { ok: false, reason: "failsafe_error" };
  }
}

export async function stepOrchestration(
  prisma: PrismaLike,
  deps: {
    runStep: (orch: Orchestration) => Promise<{ to: OrchState; patch?: any }>;
    killSwitch?: () => boolean;
    now?: () => Date;
  },
  orch: Orchestration
): Promise<{ ok: boolean; to?: OrchState; reason?: string }> {
  if (isTerminal(orch.state)) return { ok: false, reason: "terminal" };
  const now = deps.now ?? (() => new Date());

  try {
    let next: { to: OrchState; patch?: any };
    if (deps.killSwitch?.()) {
      next = { to: "cancelled", patch: { lastError: "kill-switch" } };
    } else {
      next = await deps.runStep(orch);
    }

    // Un paso normal exitoso RESETEA el contador de errores de paso (consecutivos, no de por
    // vida): así hipos de infra aislados no se acumulan hasta forzar `materially_blocked` en
    // un run que sí progresa. Se pliega en la MISMA transición (sin escritura extra ni carrera):
    // se retira `stepErrors`/`lastStepError` del `plan` que se va a persistir.
    const patch = clearStepErrorsOnSuccess(orch, next.patch);

    const res = await transition(prisma, {
      id: orch.id,
      workspaceId: orch.workspaceId,
      from: orch.state,
      to: next.to,
      expectedVersion: orch.version,
      patch
    });
    // El lease lo gestiona `runBatch` (libera al terminar/park con guard de dueño). Aquí
    // no lo tocamos: si otro worker re-tomó la fila (nuestro lease expiró), res.ok es false.
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, to: next.to };
  } catch (e: any) {
    // FAIL-SAFE: cualquier excepción parcial (runStep o transición) → recuperación acotada
    // en lugar de dejar el run atascado repitiendo trabajo caro tick tras tick.
    return await failSafeRecover(prisma, orch, e, now);
  }
}

export type BatchResult = {
  claimed: number;
  advanced: number; // runs que avanzaron ≥1 paso
  completed: number;
  parked: number; // waiting_backoff / approval_required
  terminal: number; // completed + materially_blocked + budget_exhausted + cancelled
  errors: number; // runs con error parcial (no bloquean el lote)
  steps: number; // transiciones aplicadas en total
};

/**
 * Procesa un lote: reclama runs due, y avanza CADA uno paso a paso hasta terminal,
 * parked (waiting_backoff/approval_required), un tope de pasos por run, o agotar el
 * presupuesto de tiempo del lote. Al soltar un run, LIBERA el lease (guard de dueño).
 * Errores parciales de un run NO abortan el lote. Resultado agregado sin PII.
 */
export async function runBatch(
  prisma: PrismaLike,
  deps: { runStep: (orch: Orchestration) => Promise<{ to: OrchState; patch?: any }>; killSwitch?: () => boolean; now: () => Date; owner: string; leaseMs: number; batchSize?: number; maxStepsPerRun?: number; maxWallMs?: number; attemptBudgetMs?: number },
  reload: (orch: Orchestration) => Promise<Orchestration | null>
): Promise<BatchResult> {
  const startedMs = deps.now().getTime();
  const maxWallMs = deps.maxWallMs ?? 25_000;
  const maxSteps = deps.maxStepsPerRun ?? 12;
  // No arrancar un paso si no cabe dentro del presupuesto del lote (un intento puede
  // durar hasta attemptBudgetMs). Así un paso nunca termina tras expirar el lease.
  const attemptBudgetMs = deps.attemptBudgetMs ?? 0;
  const canStartStep = () => deps.now().getTime() - startedMs + attemptBudgetMs <= maxWallMs;
  const agg: BatchResult = { claimed: 0, advanced: 0, completed: 0, parked: 0, terminal: 0, errors: 0, steps: 0 };

  const claimed = await claimDue(prisma, { owner: deps.owner, now: deps.now(), leaseMs: deps.leaseMs, limit: deps.batchSize ?? 5 });
  agg.claimed = claimed.length;

  for (const initial of claimed) {
    if (!canStartStep()) break; // presupuesto de tiempo del lote agotado
    let orch: Orchestration | null = initial;
    let movedThisRun = false;
    try {
      for (let i = 0; i < maxSteps && orch; i++) {
        if (!canStartStep()) break;
        if (isTerminal(orch.state)) break;
        const r = await stepOrchestration(prisma, { runStep: deps.runStep, killSwitch: deps.killSwitch, now: deps.now }, orch);
        if (!r.ok) {
          // La recuperación fail-safe no pudo persistir (no es un simple stale): cuéntalo como
          // error del lote para no perderlo de la observabilidad. El run no se pierde: el lease
          // se libera y el próximo tick reintenta.
          if (r.reason === "failsafe_error") agg.errors++;
          break; // stale (otro worker) o no aplicó → soltar
        }
        agg.steps++;
        movedThisRun = true;
        // Recuperación fail-safe (excepción parcial acotada): cuenta como error y NO sigue
        // en este lote — si escaló es terminal; si fue backoff queda diferido por nextRunAt
        // (evita repetir el paso caro de inmediato dentro del mismo lote).
        if (r.reason === "failsafe_blocked" || r.reason === "failsafe_backoff") {
          agg.errors++;
          if (r.to && isTerminal(r.to)) agg.terminal++;
          else agg.parked++;
          break;
        }
        if (r.to && (isTerminal(r.to) || PARKED_STATES.has(r.to))) {
          if (isTerminal(r.to)) agg.terminal++;
          if (r.to === "completed") agg.completed++;
          if (PARKED_STATES.has(r.to)) agg.parked++;
          break;
        }
        orch = await reload(orch); // recarga estado/versión para el siguiente paso
      }
    } catch (e: any) {
      agg.errors++; // error parcial: NO bloquea el resto del lote
      // Observabilidad sin PII: solo la clase del error para diagnosticar la causa.
      console.warn(`[ai-scheduler] run ${initial.id} error parcial: ${String(e?.name ?? "error")}`);
    } finally {
      const rel = await releaseLease(prisma, { id: initial.id, workspaceId: initial.workspaceId, leaseOwner: deps.owner }).catch((e: any) => {
        console.warn(`[ai-scheduler] releaseLease ${initial.id} falló: ${String(e?.name ?? "error")}`);
        return { released: false };
      });
      void rel;
    }
    if (movedThisRun) agg.advanced++;
  }
  return agg;
}
