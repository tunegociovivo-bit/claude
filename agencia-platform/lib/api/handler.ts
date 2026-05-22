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

// Override por categoría — endpoints caros (IA = $$$) y endpoints
// críticos (admin = peligro si bucle) tienen su propio cap MUCHO más
// bajo. Se aplica POR-USER, no global, para que un cliente desbocado
// no tumbe a los demás.
const CATEGORY_LIMITS: Record<NonNullable<RateCategory>, { user: number; apikey: number }> = {
  ai: { user: 15, apikey: 30 },           // ~ 1 llamada cada 4s
  admin: { user: 30, apikey: 60 },        // operaciones sensibles, evita scripts
  destructive: { user: 10, apikey: 20 }   // borrados / purgas: a mano sí, en bucle no
};

export type RateCategory = "ai" | "admin" | "destructive" | undefined;

export type WithApiOpts = {
  scope?: string;
  /** Categoría de rate-limit más estricta. Si omitida, usa LIMITS por defecto. */
  rate?: RateCategory;
};

function bucketKey(req: NextRequest, api: ApiContext, rate: RateCategory): { key: string; limit: number } {
  const isWrite = req.method !== "GET" && req.method !== "HEAD";

  if (rate) {
    const cat = CATEGORY_LIMITS[rate];
    if (api.apiKeyId) {
      return { key: `apikey:${api.apiKeyId}:${rate}`, limit: cat.apikey };
    }
    if (api.userId) {
      return { key: `user:${api.userId}:${rate}`, limit: cat.user };
    }
  }

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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return { key: `anon:${ip}`, limit: LIMITS.anon };
}

export function withApi(opts: WithApiOpts, handler: Handler) {
  return async (req: NextRequest, ctx: { params: any }) => {
    try {
      const api = await authenticate(req);
      if (opts.scope) requireScope(api, opts.scope);

      const { key, limit } = bucketKey(req, api, opts.rate);
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
      // Respuestas de API autenticada NUNCA deben cachearse en el navegador:
      // si no, tras cambiar permisos/datos el usuario sigue viendo lo viejo
      // (p.ej. /api/v1/me con features antiguas → menú con módulos de menos).
      // Solo lo ponemos si el handler no fijó su propia política (p.ej.
      // /api/brand-icon, que sí quiere cache larga).
      if (!res.headers.has("Cache-Control")) {
        res.headers.set("Cache-Control", "no-store, must-revalidate");
      }
      return res;
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * Rate-limit por IP para endpoints PÚBLICOS (los /p/[token] de
 * portales de aprobación, los /api/public/*). Sin auth, así que no
 * podemos identificar al actor — la única defensa es la IP.
 *
 * Devuelve null si OK, o un NextResponse 429 si está rate-limited.
 * Para usar en endpoints que NO van por withApi (porque withApi
 * exige auth).
 */
export function rateLimitPublic(req: NextRequest, opts: { limit?: number; tag: string }): NextResponse | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = opts.limit ?? 60; // 1 / segundo de media por IP
  const rl = rateLimit(`public:${opts.tag}:${ip}`, limit);
  if (rl.ok) return null;
  const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: "rate_limited", message: `Has superado ${limit} peticiones por minuto. Espera ${retryAfter}s.` },
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
