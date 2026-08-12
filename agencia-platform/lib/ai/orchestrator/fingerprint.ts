/**
 * Huellas (fingerprints) y detector de bucles (Slice 2c) — puro y determinista.
 *
 * Una huella normaliza un intento (fase + estrategia + clase de diagnóstico +
 * objetivo, con ids/números/tokens borrados) para que "el mismo fallo" colisione.
 * Si una huella se repite ≥ umbral, el orquestador está en bucle → parar.
 */
import type { DiagnosisClass } from "./diagnosis";

export type AttemptShape = {
  phase: string;
  strategy: string;
  diagnosis?: DiagnosisClass | null;
  target?: string | null; // p.ej. acción/herramienta o proveedor
  model?: string | null; // el modelo cuenta: dos modelos de un proveedor NO son "el mismo intento"
  error?: string | null;
};

/** Normaliza texto: minúsculas, ids/uuids/números/tokens → placeholders. Los números
 *  se borran AUNQUE estén pegados a letras (task12345, shard7) para que "el mismo
 *  fallo con un contador embebido" colisione y el detector de bucles no lo evada. */
export function normalizeError(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/g, "<hex>")
    .replace(/\d[\d.,]*/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Hash estable (djb2) → base36. No cripto; solo para agrupar/detectar bucles. */
export function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function fingerprint(a: AttemptShape): string {
  const parts = [a.phase, a.strategy, a.diagnosis ?? "", a.target ?? "", a.model ?? "", normalizeError(a.error)];
  return stableHash(parts.join("|"));
}

/** ¿Estamos en bucle? La huella actual ya apareció ≥ (threshold-1) veces antes. */
export function isLooping(history: string[], fp: string, threshold = 3): boolean {
  let count = 0;
  for (const h of history) if (h === fp) count++;
  return count + 1 >= threshold; // +1 = el intento actual
}

/** Cuenta ocurrencias de cada huella (para el panel/diagnóstico). */
export function fingerprintCounts(history: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const h of history) m[h] = (m[h] ?? 0) + 1;
  return m;
}
