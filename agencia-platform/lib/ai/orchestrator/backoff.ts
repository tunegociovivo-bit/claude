/**
 * Backoff exponencial con jitter (Slice 2c) — puro. El RNG es INYECTABLE para
 * tests deterministas (por defecto Math.random en runtime real).
 */
export type BackoffOpts = {
  baseMs?: number; // retardo base
  factor?: number; // multiplicador exponencial
  maxMs?: number; // techo por intento
  jitter?: number; // fracción de jitter [0..1] (full jitter si 1)
};

const DEFAULTS = { baseMs: 1000, factor: 3, maxMs: 60_000, jitter: 0.5 };

/**
 * Retardo (ms) para el intento `attempt` (0-indexed). Con jitter "full" (1) el
 * resultado ∈ [0, cap]; con jitter 0 es determinista = cap.
 */
export function backoffMs(attempt: number, opts: BackoffOpts = {}, rand: () => number = Math.random): number {
  const { baseMs, factor, maxMs, jitter } = { ...DEFAULTS, ...opts };
  const raw = baseMs * Math.pow(factor, Math.max(0, attempt));
  const cap = Math.min(maxMs, raw);
  const j = Math.min(1, Math.max(0, jitter));
  if (j === 0) return Math.round(cap);
  // Full-jitter parcial: mantiene (1-j)·cap fijo y reparte j·cap aleatorio.
  const fixed = cap * (1 - j);
  const variable = cap * j * clamp01(rand());
  return Math.round(fixed + variable);
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
