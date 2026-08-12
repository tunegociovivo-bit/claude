/**
 * Presupuestos del orquestador (Slice 2c) — puro. Limita intentos, tiempo,
 * tokens y coste. Cuando cualquiera se agota → estado `budget_exhausted`.
 */
export type BudgetLimits = {
  maxAttempts: number;
  maxWallMs: number;
  maxTokens: number;
  maxCostUsd: number;
};

export type BudgetUsage = {
  attempts: number;
  elapsedMs: number;
  tokens: number;
  costUsd: number;
};

export const DEFAULT_LIMITS: BudgetLimits = {
  maxAttempts: 6,
  maxWallMs: 10 * 60_000, // 10 min de reloj
  maxTokens: 400_000,
  maxCostUsd: 2.0
};

export type BudgetStatus = {
  exhausted: boolean;
  /** Qué límite se agotó primero (para el decision packet). */
  reason: "attempts" | "wall" | "tokens" | "cost" | null;
  remaining: { attempts: number; wallMs: number; tokens: number; costUsd: number };
};

export function sanitizeLimits(partial?: Partial<BudgetLimits>): BudgetLimits {
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  return {
    maxAttempts: n(partial?.maxAttempts, DEFAULT_LIMITS.maxAttempts),
    maxWallMs: n(partial?.maxWallMs, DEFAULT_LIMITS.maxWallMs),
    maxTokens: n(partial?.maxTokens, DEFAULT_LIMITS.maxTokens),
    maxCostUsd: n(partial?.maxCostUsd, DEFAULT_LIMITS.maxCostUsd)
  };
}

/** Evalúa el presupuesto. Determinista. El primer límite superado marca `reason`. */
/** Uso seguro: un contador NaN/±Infinity significa que la contabilidad se rompió →
 *  lo tratamos como AGOTADO (Infinity) para parar de forma fail-safe, nunca seguir
 *  ilimitadamente. Un valor negativo (sin sentido) se satura a 0. */
function safeUsage(v: number): number {
  if (!Number.isFinite(v)) return Infinity;
  return v < 0 ? 0 : v;
}

export function budgetStatus(usage: BudgetUsage, limits: BudgetLimits = DEFAULT_LIMITS): BudgetStatus {
  const u = {
    attempts: safeUsage(usage.attempts),
    elapsedMs: safeUsage(usage.elapsedMs),
    tokens: safeUsage(usage.tokens),
    costUsd: safeUsage(usage.costUsd)
  };
  const remaining = {
    attempts: limits.maxAttempts - u.attempts,
    wallMs: limits.maxWallMs - u.elapsedMs,
    tokens: limits.maxTokens - u.tokens,
    costUsd: round4(limits.maxCostUsd - u.costUsd)
  };
  let reason: BudgetStatus["reason"] = null;
  if (u.attempts >= limits.maxAttempts) reason = "attempts";
  else if (u.elapsedMs >= limits.maxWallMs) reason = "wall";
  else if (u.tokens >= limits.maxTokens) reason = "tokens";
  else if (u.costUsd >= limits.maxCostUsd) reason = "cost";
  return { exhausted: reason !== null, reason, remaining };
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
