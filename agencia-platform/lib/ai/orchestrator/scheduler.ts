/**
 * Cableado de producción del scheduler (entrypoint). Construye las `RunStepDeps`
 * reales: llamada de modelo vía los adaptadores (live/shadow según flags), breaker
 * por proveedor y lock en memoria (por-proceso; una réplica de cron a la vez), y un
 * `buildRequest` mínimo derivado del `plan.objective` ya saneado.
 *
 * NOTA de durabilidad: el breaker/lock son POR PROCESO. Con un único cron single-flight
 * es suficiente para el canary A0/A1. Un breaker/lock DURABLE cross-proceso (advisory
 * lock/Redis + tabla) es una mejora posterior; la interfaz ya está lista para ella.
 */
import { buildAdapter, type AdapterRequest, type AdapterResult, type KeySources } from "./adapters";
import { initBreaker, type BreakerSnapshot } from "./circuit-breaker";
import { DEFAULT_LIMITS, type BudgetLimits } from "./budget";
import { orchestratorMode, multiModelEnabled } from "./flags";
import { makeRunStep, type RunStepDeps } from "./run-step";
import type { Lock } from "./runtime";
import type { ModelSlot } from "./providers";
import type { Orchestration } from "./store";

// Estado del breaker por proveedor (por-proceso).
const BREAKERS = new Map<string, BreakerSnapshot>();
function loadBreaker(provider: string): Promise<BreakerSnapshot> {
  return Promise.resolve(BREAKERS.get(provider) ?? initBreaker());
}
function persistBreaker(provider: string, snap: BreakerSnapshot): Promise<void> {
  BREAKERS.set(provider, snap);
  return Promise.resolve();
}

// Lock por clave (mutex en memoria) → serializa canPass→markProbe por proveedor.
const CHAINS = new Map<string, Promise<unknown>>();
const inProcessLock: Lock = async (key, fn) => {
  const prev = CHAINS.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  CHAINS.set(key, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
};

/** Presupuestos MUY bajos para el canary (se pueden subir por env más adelante). */
export function canaryLimits(env: NodeJS.ProcessEnv = process.env): BudgetLimits {
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? x : d;
  };
  return {
    maxAttempts: n(env.AI_CANARY_MAX_ATTEMPTS, 3),
    maxWallMs: n(env.AI_CANARY_MAX_WALL_MS, 20_000),
    maxTokens: n(env.AI_CANARY_MAX_TOKENS, 4_000),
    maxCostUsd: n(env.AI_CANARY_MAX_COST_USD, 0.05)
  };
}

/** Request mínimo del run desde `plan.objective` (ya saneado al crear el run). El
 *  adaptador vuelve a redactar PII antes de cualquier egress. */
async function defaultBuildRequest(orch: Orchestration): Promise<AdapterRequest> {
  const plan = (orch.plan as any) ?? {};
  const objective = typeof plan.objective === "string" ? plan.objective : "";
  return { system: typeof plan.system === "string" ? plan.system : undefined, messages: [{ role: "user", content: objective }], maxOutputTokens: 512, capabilities: plan.need?.capabilities ?? [] };
}

export function buildSchedulerDeps(env: NodeJS.ProcessEnv, keySources: KeySources): RunStepDeps {
  const live = multiModelEnabled(env) && orchestratorMode(env) === "live";
  return {
    now: () => new Date(),
    env,
    keySources,
    live,
    limits: canaryLimits(env),
    attemptDeadlineMs: Number(env.AI_ATTEMPT_DEADLINE_MS) || 15_000,
    loadBreaker,
    persistBreaker,
    lock: inProcessLock,
    // Envuelve el adaptador: live=real, shadow=simulado. Claves server-side; sin efectos.
    callModel: (slot: ModelSlot, req: AdapterRequest, opts) => buildAdapter(slot).complete(req, { live: opts.live, keySources, signal: opts.signal }) as Promise<AdapterResult>,
    buildRequest: defaultBuildRequest,
    rand: Math.random
  };
}

export function buildRunStep(prisma: any, env: NodeJS.ProcessEnv, keySources: KeySources) {
  return makeRunStep(prisma, buildSchedulerDeps(env, keySources));
}

/** Solo para pruebas/operación: limpia el estado por-proceso del breaker. */
export function __resetSchedulerState() {
  BREAKERS.clear();
  CHAINS.clear();
}
