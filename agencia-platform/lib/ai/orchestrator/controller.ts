/**
 * Núcleo de decisión del orquestador (Slice 2c) — PURO. Dado el resultado de un
 * intento fallido (diagnóstico + presupuesto + historial), decide la SIGUIENTE
 * transición SIN ejecutar nada. La capa de persistencia (store) aplica la
 * transición de forma concurrency-safe; el driver ejecuta el efecto (en shadow).
 *
 * Este es el "cerebro" testeable: la recuperación resiliente sin tocar BD ni red.
 */
import { type OrchState } from "./state-machine";
import { type Diagnosis } from "./diagnosis";
import { budgetStatus, type BudgetLimits, type BudgetUsage } from "./budget";
import { isLooping } from "./fingerprint";
import { chooseNextStrategy, type Strategy, type StrategyContext } from "./strategy";
import { backoffMs, type BackoffOpts } from "./backoff";
import { buildDecisionPacket, type DecisionPacket, type AttemptSummary } from "./decision-packet";

export type RecoveryInput = {
  diagnosis: Diagnosis;
  usage: BudgetUsage;
  limits: BudgetLimits;
  fingerprintHistory: string[]; // huellas de intentos previos
  currentFingerprint: string; // huella del intento actual
  loopThreshold?: number;
  strategyCtx: StrategyContext;
  attempts: AttemptSummary[];
  backoff?: BackoffOpts;
  rand?: () => number;
  /** Kill-switch operativo: si está activo, cualquier decisión es `cancelled`
   *  (parada segura), por encima de todo lo demás. Propagado por el worker/loop. */
  killSwitch?: boolean;
};

export type RecoveryDecision = {
  to: OrchState;
  strategy?: Strategy;
  backoffMs?: number;
  packet?: DecisionPacket;
  reason: string;
};

/**
 * Decide qué hacer tras un fallo (estado `diagnosing`). Orden de comprobaciones:
 *   0) kill-switch → cancelled (parada segura, por encima de todo)
 *   1) diagnóstico material (missing_data/goal_conflict) → materially_blocked (+packet)
 *   2) política → approval_required (+packet)
 *   3) presupuesto agotado → budget_exhausted (+packet)
 *   4) bucle detectado → materially_blocked (+packet loop)
 *   5) estrategia distinta disponible → decomposing | waiting_backoff (+strategy)
 *   6) sin estrategia distinta → materially_blocked (+packet)
 * Material/política van ANTES que presupuesto/bucle: una causa accionable (falta una
 * credencial, requiere aprobación) debe surgir al humano tal cual, no enmascarada como
 * "amplía el presupuesto" / "estás en bucle" cuando ambos coinciden (MEDIUM-2).
 * Determinista dado `rand` (por defecto Math.random para el jitter).
 */
export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  const { diagnosis, usage, limits, attempts, strategyCtx } = input;

  // 0) Kill-switch operativo → parada segura inmediata.
  if (input.killSwitch) {
    return {
      to: "cancelled",
      reason: "Kill-switch activo: parada segura",
      packet: buildDecisionPacket({ cause: "cancelled", diagnosis: "Detenido por kill-switch operativo.", attempts, triedStrategies: strategyCtx.tried })
    };
  }

  // 1) Material (accionable): prioridad sobre presupuesto/bucle.
  if (diagnosis.material) {
    const cause = diagnosis.class === "goal_conflict" ? "goal_conflict" : "missing_data";
    return {
      to: "materially_blocked",
      reason: diagnosis.reason,
      packet: buildDecisionPacket({ cause, diagnosis: diagnosis.reason, attempts, triedStrategies: strategyCtx.tried })
    };
  }

  // 2) Política → aprobación (accionable): prioridad sobre presupuesto/bucle.
  if (diagnosis.class === "policy") {
    return {
      to: "approval_required",
      reason: "Requiere aprobación de política",
      packet: buildDecisionPacket({ cause: "policy_approval", diagnosis: diagnosis.reason, attempts, triedStrategies: strategyCtx.tried })
    };
  }

  // 3) Presupuesto
  const budget = budgetStatus(usage, limits);
  if (budget.exhausted) {
    return {
      to: "budget_exhausted",
      reason: `Presupuesto agotado (${budget.reason})`,
      packet: buildDecisionPacket({
        cause: "budget_exhausted",
        diagnosis: `${diagnosis.reason}. Límite agotado: ${budget.reason}.`,
        attempts,
        triedStrategies: strategyCtx.tried
      })
    };
  }

  // 4) Bucle
  if (isLooping(input.fingerprintHistory, input.currentFingerprint, input.loopThreshold ?? 3)) {
    return {
      to: "materially_blocked",
      reason: "Bucle detectado (misma huella repetida)",
      packet: buildDecisionPacket({
        cause: "loop_detected",
        diagnosis: `${diagnosis.reason}. Se repite el mismo fallo sin avance.`,
        attempts,
        triedStrategies: strategyCtx.tried
      })
    };
  }

  // 5) Estrategia materialmente distinta
  const next = chooseNextStrategy(diagnosis, strategyCtx);
  if (!next) {
    return {
      to: "materially_blocked",
      reason: "No quedan estrategias materialmente distintas",
      packet: buildDecisionPacket({ cause: "no_distinct_strategy", diagnosis: diagnosis.reason, attempts, triedStrategies: strategyCtx.tried })
    };
  }
  if (next.kind === "decompose") {
    return { to: "decomposing", strategy: next, reason: "Descomponer en subtareas" };
  }
  const wait = backoffMs(usage.attempts, input.backoff, input.rand ?? Math.random);
  return { to: "waiting_backoff", strategy: next, backoffMs: wait, reason: `Reintentar con estrategia distinta: ${next.label}` };
}
