import { NextRequest, NextResponse } from "next/server";
import { authenticate, errorResponse, requireScope, type ApiContext } from "./auth";
import { rateLimit } from "./rate-limit";

type Handler = (req: NextRequest, ctx: { params: any; api: ApiContext }) => Promise<NextResponse>;

// Limits por minuto. Métodos de escritura más estrictos que lectura.
// API keys más generosas que sesiones humanas porque suelen ser para
// integraciones (Make/Zapier) que sí pueden hacer ráfagas.
const LIMITS = {
  read_user: 240,
  write_user: 60,
  read_apikey: 600,
  write_apikey: 240,
  anon: 30
};

function bucketKey(req: NextRequest, api: ApiContext): { key: string; limit: number } {
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  if (api.apiKeyId) {
    return {
      key: `apikey:${api.apiKeyId}:${isWrite ? "w" : "r"}`,
      limit: isWrite ? LIMITS.write_apikey : LIMITS.read_apikey
    };
  }
  if (api.userId) {
    return {
      key: `user:${api.userId}:${isWrite ? "w" : "r"}`,
      limit: isWrite ? LIMITS.write_user : LIMITS.read_user
    };
  }
  // Sin auth todavía no debería pasar (authenticate falla antes), pero
  // por defensa lo limitamos por IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return { key: `anon:${ip}`, limit: LIMITS.anon };
}

export function withApi(opts: { scope?: string }, handler: Handler) {
  return async (req: NextRequest, ctx: { params: any }) => {
    try {
      const api = await authenticate(req);
      if (opts.scope) requireScope(api, opts.scope);

      const { key, limit } = bucketKey(req, api);
      const rl = rateLimit(key, limit);
      if (!rl.ok) {
        const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
        return NextResponse.json(
          {
            error: "rate_limited",
            message: `Has superado ${limit} peticiones por minuto. Espera ${retryAfter}s.`
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(retryAfter),
              "X-RateLimit-Limit": String(limit),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(Math.ceil(rl.resetAt / 1000))
            }
          }
        );
      }

      const res = await handler(req, { ...ctx, api });
      res.headers.set("X-RateLimit-Limit", String(limit));
      res.headers.set("X-RateLimit-Remaining", String(rl.remaining));
      res.headers.set("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
      return res;
    } catch (err) {
      return errorResponse(err);
    }
  };
}
