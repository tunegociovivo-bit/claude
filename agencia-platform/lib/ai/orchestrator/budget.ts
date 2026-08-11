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
export function budgetStatus(usage: BudgetUsage, limits: BudgetLimits = DEFAULT_LIMITS): BudgetStatus {
  const remaining = {
    attempts: limits.maxAttempts - usage.attempts,
    wallMs: limits.maxWallMs - usage.elapsedMs,
    tokens: limits.maxTokens - usage.tokens,
    costUsd: round4(limits.maxCostUsd - usage.costUsd)
  };
  let reason: BudgetStatus["reason"] = null;
  if (usage.attempts >= limits.maxAttempts) reason = "attempts";
  else if (usage.elapsedMs >= limits.maxWallMs) reason = "wall";
  else if (usage.tokens >= limits.maxTokens) reason = "tokens";
  else if (usage.costUsd >= limits.maxCostUsd) reason = "cost";
  return { exhausted: reason !== null, reason, remaining };
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
