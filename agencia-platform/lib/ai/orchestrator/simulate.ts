/**
 * Simulador SHADOW del bucle de recuperación (Slice 2c.3) — PURO y determinista
 * (reloj y aleatoriedad inyectados; sin BD, sin red). Dado un ESCENARIO de intentos
 * (qué pasa en cada ejecución), recorre la máquina de estados como lo haría el
 * orquestador real: plan→ejecutar→verificar→diagnosticar→recuperar (backoff/
 * descomponer/estrategia distinta)→completar o escalar, respetando presupuestos,
 * detector de bucles y estrategia materialmente distinta.
 *
 * NADA se ejecuta de verdad: es una simulación para demostrar/testear el motor.
 */
import { isTerminal, type OrchState } from "./state-machine";
import { classifyFailure, type DiagnosisInput } from "./diagnosis";
import { decideRecovery } from "./controller";
import { fingerprint } from "./fingerprint";
import { buildDecisionPacket, type DecisionPacket, type AttemptSummary } from "./decision-packet";
import { type BudgetLimits, DEFAULT_LIMITS, type BudgetUsage } from "./budget";
import { type Strategy, type StrategyContext } from "./strategy";
import { type BackoffOpts } from "./backoff";

/** Qué ocurre en un intento de ejecución (inyectado por el escenario/tests). */
export type AttemptOutcome = {
  ok: boolean; // ¿la ejecución (simulada) fue bien?
  verifyOk?: boolean; // si ok: ¿pasó la verificación? (default true)
  diagnosis?: DiagnosisInput; // si !ok: pista de diagnóstico
  provider?: string;
  tokens?: number;
  costUsd?: number;
  elapsedMs?: number;
};

export type SimConfig = {
  limits?: BudgetLimits;
  strategyCtx?: StrategyContext;
  backoff?: BackoffOpts;
  loopThreshold?: number;
  rand?: () => number;
  maxLoops?: number;
};

export type TraceStep = { seq: number; phase: string; strategy?: string | null; provider?: string | null; ok?: boolean | null; diagnosis?: string | null; costUsd?: number | null; backoffMs?: number | null };

export type SimResult = {
  finalState: OrchState;
  steps: TraceStep[];
  usage: BudgetUsage;
  decision?: DecisionPacket;
  attempts: AttemptSummary[];
};

export function simulateRun(scenario: AttemptOutcome[], config: SimConfig = {}): SimResult {
  const limits = config.limits ?? DEFAULT_LIMITS;
  const strategyCtxBase = config.strategyCtx ?? { tried: [] };
  const rand = config.rand ?? Math.random;
  const maxLoops = config.maxLoops ?? 20;

  const steps: TraceStep[] = [];
  let seq = 0;
  const push = (phase: string, extra: Partial<TraceStep> = {}) => steps.push({ seq: seq++, phase, ...extra });

  const usage: BudgetUsage = { attempts: 0, elapsedMs: 0, tokens: 0, costUsd: 0 };
  const fpHistory: string[] = [];
  const tried: Strategy[] = [...(strategyCtxBase.tried ?? [])];
  const attemptSummaries: AttemptSummary[] = [];
  let strategy: Strategy = { kind: "retry_same", provider: null, model: null, label: "intento inicial" };

  push("planning");
  push("executing");

  const bound = Math.min(scenario.length, maxLoops);
  for (let i = 0; i < bound; i++) {
    const a = scenario[i];
    usage.attempts++;
    usage.elapsedMs += a.elapsedMs ?? 1000;
    usage.tokens += a.tokens ?? 100;
    usage.costUsd = Math.round((usage.costUsd + (a.costUsd ?? 0.01)) * 1e4) / 1e4;
    push("executing", { strategy: strategy.label, provider: a.provider ?? strategy.provider ?? null, ok: a.ok, costUsd: a.costUsd ?? null });
    attemptSummaries.push({ seq: i, strategy: strategy.label, diagnosis: null, ok: a.ok });

    let diag;
    if (a.ok) {
      push("verifying");
      if (a.verifyOk !== false) {
        push("completed");
        return { finalState: "completed", steps, usage, attempts: attemptSummaries };
      }
      diag = classifyFailure({ verificationFailed: true });
    } else {
      diag = classifyFailure(a.diagnosis ?? {});
    }

    push("diagnosing", { diagnosis: diag.class });
    const fp = fingerprint({ phase: "executing", strategy: strategy.kind, diagnosis: diag.class, target: strategy.provider, error: a.diagnosis?.error });
    const decision = decideRecovery({
      diagnosis: diag,
      usage,
      limits,
      fingerprintHistory: fpHistory,
      currentFingerprint: fp,
      loopThreshold: config.loopThreshold,
      strategyCtx: { ...strategyCtxBase, tried },
      attempts: attemptSummaries,
      backoff: config.backoff,
      rand
    });
    fpHistory.push(fp);
    attemptSummaries[attemptSummaries.length - 1].diagnosis = diag.class;

    if (isTerminal(decision.to) || decision.to === "approval_required") {
      push(decision.to);
      return { finalState: decision.to, steps, usage, decision: decision.packet, attempts: attemptSummaries };
    }
    // recuperación: decomposing | waiting_backoff → volver a executing con nueva estrategia
    if (decision.strategy) {
      strategy = decision.strategy;
      tried.push(strategy);
    }
    if (decision.to === "decomposing") push("decomposing", { strategy: strategy.label });
    else push("waiting_backoff", { backoffMs: decision.backoffMs ?? null });
    push("executing", { strategy: strategy.label });
  }

  // Escenario agotado sin estado terminal → bloqueo material (no hay más info).
  push("materially_blocked");
  return {
    finalState: "materially_blocked",
    steps,
    usage,
    attempts: attemptSummaries,
    decision: buildDecisionPacket({ cause: "no_distinct_strategy", diagnosis: "Escenario de simulación agotado sin resolver", attempts: attemptSummaries, triedStrategies: tried })
  };
}
