/**
 * Decision packet de escalada (Slice 2c) — puro. Una escalada SIEMPRE lleva UN
 * paquete con: diagnóstico, estrategias intentadas, evidencia, alternativas y una
 * ÚNICA decisión concreta. Nunca un "no pude" genérico.
 */
import type { DiagnosisClass } from "./diagnosis";
import type { Strategy } from "./strategy";

export type EscalationCause = "missing_data" | "goal_conflict" | "budget_exhausted" | "policy_approval" | "loop_detected" | "no_distinct_strategy";

export type AttemptSummary = {
  seq: number;
  strategy: string;
  // Solo la CLASE de diagnóstico, nunca el texto crudo del error (evita filtrar
  // PII/secretos al panel/escalada, que se sirven a cualquier `tasks:read`).
  diagnosis?: DiagnosisClass | null;
  ok: boolean;
};

export type Evidence = { label: string; detail: string };

export type DecisionPacket = {
  cause: EscalationCause;
  title: string;
  diagnosis: string;
  strategiesTried: string[];
  attempts: AttemptSummary[];
  evidence: Evidence[];
  alternatives: string[];
  /** La ÚNICA pregunta/decisión concreta para el humano. */
  decision: string;
};

const CAUSE_COPY: Record<EscalationCause, { title: string; decision: string }> = {
  missing_data: { title: "Faltan datos que no puedo inferir", decision: "¿Puedes aportar el dato/credencial que falta, o autorizas continuar sin él?" },
  goal_conflict: { title: "Objetivos en conflicto", decision: "¿Cuál de los objetivos tiene prioridad?" },
  budget_exhausted: { title: "Presupuesto agotado tras varias estrategias", decision: "¿Amplío el presupuesto (tiempo/tokens/coste) o lo dejo aquí?" },
  policy_approval: { title: "La acción requiere tu aprobación", decision: "¿Apruebas esta acción (una vez o como política reutilizable) o la rechazas?" },
  loop_detected: { title: "Detecté un bucle sin avance", decision: "¿Reformulo el enfoque con tu guía o lo detengo?" },
  no_distinct_strategy: { title: "No me quedan estrategias distintas", decision: "¿Sugieres un enfoque alternativo o lo detengo?" }
};

export function buildDecisionPacket(input: {
  cause: EscalationCause;
  diagnosis: string;
  attempts: AttemptSummary[];
  triedStrategies: Strategy[];
  evidence?: Evidence[];
  alternatives?: string[];
}): DecisionPacket {
  const copy = CAUSE_COPY[input.cause];
  return {
    cause: input.cause,
    title: copy.title,
    diagnosis: input.diagnosis,
    strategiesTried: input.triedStrategies.map((s) => s.label),
    attempts: input.attempts.slice(-10), // últimas 10, acotado
    evidence: (input.evidence ?? []).slice(0, 10),
    alternatives: input.alternatives ?? defaultAlternatives(input.cause),
    decision: copy.decision
  };
}

function defaultAlternatives(cause: EscalationCause): string[] {
  switch (cause) {
    case "missing_data":
      return ["Aportar el dato y reintentar", "Continuar con un valor por defecto seguro", "Posponer la tarea"];
    case "goal_conflict":
      return ["Priorizar objetivo A", "Priorizar objetivo B", "Redefinir la tarea"];
    case "budget_exhausted":
      return ["Ampliar presupuesto", "Reducir el alcance", "Dejarlo como está"];
    default:
      return ["Dar guía y reintentar", "Detener la tarea"];
  }
}
