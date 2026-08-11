/**
 * Diagnóstico CLASIFICADO de un fallo (Slice 2c) — puro y determinista.
 *
 * Amplía la clasificación binaria del runner actual (`classifyError`:
 * credential/transient/technical en process-run.ts) a las 8 clases que el
 * orquestador necesita para decidir recuperación vs escalada.
 */
export const DIAGNOSIS_CLASSES = [
  "transient", // 5xx/red/timeout de infraestructura → reintentable tal cual
  "tool", // una herramienta falló (entrada mala, endpoint 4xx) → cambiar de estrategia
  "provider", // el proveedor de modelo falló/agotó cuota → probar otro proveedor (Slice 3)
  "missing_data", // faltan credenciales/datos que no se pueden inferir → escalar material
  "policy", // bloqueado por política/gate de autonomía → requiere aprobación
  "goal_conflict", // objetivos incompatibles → escalar material (decisión humana)
  "verification_failed", // se ejecutó pero la verificación no pasó → reintentar/descomponer
  "unknown" // no clasificable → tratar conservador (escalar tras pocos intentos)
] as const;
export type DiagnosisClass = (typeof DIAGNOSIS_CLASSES)[number];

export type DiagnosisInput = {
  error?: string | null;
  /** Señal explícita de la capa que detecta el fallo (tiene prioridad sobre el texto). */
  hint?: DiagnosisClass | null;
  /** ¿La verificación (reviewer) rechazó el resultado? */
  verificationFailed?: boolean;
  /** ¿La política/gate bloqueó la acción? */
  policyBlocked?: boolean;
};

export type Diagnosis = {
  class: DiagnosisClass;
  /** ¿Es materialmente irrecuperable por el agente (requiere humano)? */
  material: boolean;
  /** ¿Reintentable con la MISMA estrategia? (solo transitorios). */
  retriableSameStrategy: boolean;
  /** ¿Se beneficia de una estrategia/modelo distinto? */
  needsNewStrategy: boolean;
  reason: string;
};

const RX = {
  transient: /\b(429|5\d\d|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|overloaded|rate.?limit|timeout|temporarily|service unavailable|bad gateway|gateway timeout)\b/i,
  provider: /\b(anthropic|openai|gemini|perplexity|model|completion|context.?length|max.?tokens|content.?policy|api key|unauthorized|401|invalid_api_key|insufficient_quota|quota)\b/i,
  missing_data: /\b(missing|not found|no such|credential|no configurad|falta|sin datos|undefined variable|requires? (a )?value|no .*token|sin credencial)\b/i,
  tool: /\b(400|422|validation|invalid (argument|input|parameter)|bad request|schema|unsupported|tool .*fail|executor)\b/i,
  goal_conflict: /\b(conflict|contradic|incompatible|ambiguous|no se puede a la vez|objetivos)\b/i
};

/**
 * Clasifica un fallo. `hint`/señales explícitas mandan sobre el texto (el texto
 * es heurístico). Determinista: mismas entradas → misma salida.
 */
export function classifyFailure(input: DiagnosisInput): Diagnosis {
  const err = (input.error ?? "").toString();

  // 1) Señales explícitas de la capa (más fiables que el texto).
  if (input.policyBlocked) return mk("policy", { material: false, needsNewStrategy: false, reason: "Bloqueado por política de autonomía" });
  if (input.verificationFailed) return mk("verification_failed", { needsNewStrategy: true, reason: "La verificación rechazó el resultado" });
  if (input.hint) return fromClass(input.hint, err);

  // 2) Heurística sobre el texto (orden: lo más específico primero).
  if (RX.missing_data.test(err)) return mk("missing_data", { material: true, reason: "Faltan datos/credenciales no inferibles" });
  if (RX.goal_conflict.test(err)) return mk("goal_conflict", { material: true, reason: "Conflicto de objetivos" });
  if (RX.transient.test(err)) return mk("transient", { retriableSameStrategy: true, reason: "Fallo transitorio de infraestructura" });
  if (RX.provider.test(err)) return mk("provider", { needsNewStrategy: true, reason: "Fallo/limitación del proveedor de modelo" });
  if (RX.tool.test(err)) return mk("tool", { needsNewStrategy: true, reason: "Una herramienta falló" });

  return mk("unknown", { needsNewStrategy: true, reason: "Error no clasificable" });
}

function fromClass(cls: DiagnosisClass, err: string): Diagnosis {
  switch (cls) {
    case "transient":
      return mk("transient", { retriableSameStrategy: true, reason: "Transitorio (señalado)" });
    case "provider":
      return mk("provider", { needsNewStrategy: true, reason: "Proveedor (señalado)" });
    case "tool":
      return mk("tool", { needsNewStrategy: true, reason: "Herramienta (señalada)" });
    case "missing_data":
      return mk("missing_data", { material: true, reason: "Datos faltantes (señalado)" });
    case "policy":
      return mk("policy", { material: false, needsNewStrategy: false, reason: "Política (señalado)" });
    case "goal_conflict":
      return mk("goal_conflict", { material: true, reason: "Conflicto de objetivos (señalado)" });
    case "verification_failed":
      return mk("verification_failed", { needsNewStrategy: true, reason: "Verificación fallida (señalado)" });
    default:
      return mk("unknown", { needsNewStrategy: true, reason: err ? `Desconocido: ${err.slice(0, 80)}` : "Desconocido" });
  }
}

function mk(
  cls: DiagnosisClass,
  o: { material?: boolean; retriableSameStrategy?: boolean; needsNewStrategy?: boolean; reason: string }
): Diagnosis {
  return {
    class: cls,
    material: o.material ?? false,
    retriableSameStrategy: o.retriableSameStrategy ?? false,
    needsNewStrategy: o.needsNewStrategy ?? false,
    reason: o.reason
  };
}

/** Clases que SIEMPRE son materiales (escalada humana, no reintento). */
export function isMaterial(cls: DiagnosisClass): boolean {
  return cls === "missing_data" || cls === "goal_conflict";
}
