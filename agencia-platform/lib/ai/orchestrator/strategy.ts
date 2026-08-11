/**
 * Selección de estrategia (Slice 2c) — puro. Regla dura: solo se reintenta con
 * una estrategia MATERIALMENTE DISTINTA de las ya probadas (salvo el reintento
 * directo de un transitorio, que repite a propósito con backoff).
 *
 * NOTA Slice 3: `provider`/`model` son SLOTS de routing; aquí solo se elige la
 * etiqueta de estrategia. No se llama a ningún proveedor externo.
 */
import type { Diagnosis } from "./diagnosis";

export type Strategy = {
  kind: "retry_same" | "switch_model" | "switch_provider" | "decompose" | "reduce_scope" | "alternate_tool";
  provider?: string | null; // slot (Slice 3)
  model?: string | null; // slot (Slice 3)
  label: string;
};

/** Dos estrategias son "iguales" si coinciden kind+provider+model. */
export function strategyKey(s: Strategy): string {
  return `${s.kind}:${s.provider ?? "-"}:${s.model ?? "-"}`;
}

export function isMateriallyDistinct(a: Strategy, b: Strategy): boolean {
  return strategyKey(a) !== strategyKey(b);
}

export type StrategyContext = {
  tried: Strategy[]; // estrategias ya intentadas (en orden)
  /** Proveedores/modelos disponibles (slots de routing, Slice 3). Vacío = solo el actual. */
  availableProviders?: { provider: string; model: string }[];
  canDecompose?: boolean; // ¿la tarea admite descomposición?
};

/**
 * Elige la SIGUIENTE estrategia dada la diagnosis y lo ya probado. Devuelve null
 * si no queda ninguna materialmente distinta (→ escalar/agotar presupuesto).
 */
export function chooseNextStrategy(diagnosis: Diagnosis, ctx: StrategyContext): Strategy | null {
  const triedKeys = new Set(ctx.tried.map(strategyKey));
  const distinct = (s: Strategy): Strategy | null => (triedKeys.has(strategyKey(s)) ? null : s);

  // Transitorio: se permite UN retry_same (con backoff) si aún no se hizo.
  if (diagnosis.retriableSameStrategy) {
    const same: Strategy = { kind: "retry_same", label: "Reintentar igual (backoff)" };
    if (!triedKeys.has(strategyKey(same))) return same;
  }

  const candidates: Strategy[] = [];

  // provider/tool/verification/unknown se benefician de otra vía.
  if (diagnosis.class === "provider") {
    for (const p of ctx.availableProviders ?? []) candidates.push({ kind: "switch_provider", provider: p.provider, model: p.model, label: `Probar ${p.provider}/${p.model}` });
  }
  if (diagnosis.class === "verification_failed" || diagnosis.needsNewStrategy) {
    if (ctx.canDecompose) candidates.push({ kind: "decompose", label: "Descomponer en subtareas" });
    candidates.push({ kind: "reduce_scope", label: "Reducir el alcance" });
    candidates.push({ kind: "alternate_tool", label: "Usar una herramienta alternativa" });
    // switch_model dentro del mismo proveedor (slot; Slice 3 concreta el modelo)
    candidates.push({ kind: "switch_model", label: "Cambiar de modelo" });
  }

  for (const c of candidates) {
    const d = distinct(c);
    if (d) return d;
  }
  return null; // nada materialmente distinto pendiente
}
