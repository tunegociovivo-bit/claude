/**
 * Limitador por IP para endpoints públicos del Publicador SEO (copia del
 * `rateLimitPublic` del Hub). Ventana fija de 1 minuto en memoria.
 */
import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rate-limit";

// La última IP de X-Forwarded-For es la que añade el proxy de la plataforma
// (la primera la puede inventar el cliente para esquivar el límite).
export function clientIp(req: NextRequest): string {
  const chain = (req.headers.get("x-forwarded-for") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  return chain[chain.length - 1] || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitPublic(req: NextRequest, opts: { limit?: number; tag: string }): NextResponse | null {
  const ip = clientIp(req);
  const limit = opts.limit ?? 60;
  const rl = rateLimit(`public:${opts.tag}:${ip}`, limit);
  if (rl.ok) return null;
  const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { ok: false, error: `Demasiados intentos seguidos. Espera ${retryAfter}s y vuelve a probar.` },
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
