/**
 * Cableado de producción del scheduler (entrypoint). Construye las `RunStepDeps`
 * reales: llamada de modelo vía los adaptadores (live/shadow según flags), circuit
 * breaker DURABLE (Postgres, por workspace+proveedor, single-probe cross-proceso), y
 * un `buildRequest` mínimo derivado del `plan.objective` ya saneado.
 */
import { buildAdapter, type AdapterRequest, type AdapterResult, type KeySources } from "./adapters";
import { DEFAULT_LIMITS, type BudgetLimits } from "./budget";
import { orchestratorMode, multiModelEnabled } from "./flags";
import { makeRunStep, type RunStepDeps } from "./run-step";
import { makeDbBreaker } from "./breaker-store";
import type { ModelSlot } from "./providers";
import type { Orchestration } from "./store";

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

export function buildSchedulerDeps(prisma: any, env: NodeJS.ProcessEnv, keySources: KeySources): RunStepDeps {
  const live = multiModelEnabled(env) && orchestratorMode(env) === "live";
  const probeLeaseMs = (Number(env.AI_ATTEMPT_DEADLINE_MS) || 15_000) + 30_000; // > deadline del intento
  return {
    now: () => new Date(),
    env,
    keySources,
    live,
    limits: canaryLimits(env),
    attemptDeadlineMs: Number(env.AI_ATTEMPT_DEADLINE_MS) || 15_000,
    breaker: makeDbBreaker(prisma, undefined, probeLeaseMs),
    // Envuelve el adaptador: live=real, shadow=simulado. Claves server-side; sin efectos.
    callModel: (slot: ModelSlot, req: AdapterRequest, opts) => buildAdapter(slot).complete(req, { live: opts.live, keySources, signal: opts.signal }) as Promise<AdapterResult>,
    buildRequest: defaultBuildRequest,
    rand: Math.random
  };
}

export function buildRunStep(prisma: any, env: NodeJS.ProcessEnv, keySources: KeySources) {
  return makeRunStep(prisma, buildSchedulerDeps(prisma, env, keySources));
}
