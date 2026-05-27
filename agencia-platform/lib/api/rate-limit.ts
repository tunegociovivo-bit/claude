/**
 * Rate limit en memoria (sliding window por minuto). No es perfecto en
 * entornos multi-proceso o serverless con escala horizontal: cada
 * instancia mantiene su propio contador. Para Vercel Pro / Railway
 * con varias réplicas, migrar a Upstash Redis. Hoy nos defiende del
 * caso típico: una API key fugada que mete bucle, o un cliente
 * pidiendo cada 100ms desde una UI rota.
 */

type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 60 * 1000;

const buckets = new Map<string, Bucket>();

// Limpieza periódica para que el Map no crezca infinitamente. Cada
// minuto borramos buckets ya expirados.
let lastSweep = Date.now();
function maybeSweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
};

export function rateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  maybeSweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + WINDOW_MS };
    buckets.set(key, fresh);
    return { ok: true, remaining: limit - 1, resetAt: fresh.resetAt, limit };
  }
  existing.count++;
  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    limit
  };
}
