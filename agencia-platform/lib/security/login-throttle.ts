/**
 * Throttling y lockout de intentos de login.
 *
 * Reglas (todas dentro de la ventana LOCK_WINDOW_MIN):
 *   - >= MAX_FAILS_PER_EMAIL fallos consecutivos para un email →
 *     se rechaza el login con "locked" por LOCK_DURATION_MIN.
 *   - >= MAX_FAILS_PER_IP fallos para una IP (cualquier email) →
 *     rechazo igual. Esto frena bots que prueban emails distintos.
 *   - Un login exitoso NO resetea contadores (al diseño): si alguien
 *     atina al 4º intento todavía consideramos sospechosa la racha.
 *     La limpieza se hace por antigüedad en el cron.
 *
 * Implementación a base de prisma.loginAttempt (escrito a BD para que
 * sobreviva reinicios y sea consistente entre réplicas). Es 2-3 ms
 * por consulta — aceptable en el flujo de login.
 *
 * NO usa el rate-limit en memoria de lib/api/rate-limit.ts porque ese
 * cuenta peticiones, no fallos, y se resetea cada minuto. Para
 * lockouts queremos persistencia y ventana mayor.
 */

import { prisma } from "@/lib/db/prisma";

// Si tu equipo es muy distraído tecleando, sube MAX_FAILS_PER_EMAIL.
// Para entornos públicos (cliente final), bájalo.
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_IP = 20;
export const LOCK_WINDOW_MIN = 15;
export const LOCK_DURATION_MIN = 15;

export type ThrottleCheck =
  | { allowed: true }
  | { allowed: false; reason: "email_locked" | "ip_locked"; retryAfterSec: number };

export async function checkLoginAllowed(
  email: string,
  ip: string
): Promise<ThrottleCheck> {
  const since = new Date(Date.now() - LOCK_WINDOW_MIN * 60_000);

  // Contamos fallos en la ventana. Si el último fallo fue hace menos
  // de LOCK_DURATION_MIN, el retry-after es la diferencia hasta que
  // se cumpla.
  const [emailFails, ipFails] = await Promise.all([
    prisma.loginAttempt.findMany({
      where: { email: email.toLowerCase(), success: false, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_FAILS_PER_EMAIL
    }),
    prisma.loginAttempt.findMany({
      where: { ip, success: false, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_FAILS_PER_IP
    })
  ]);

  if (emailFails.length >= MAX_FAILS_PER_EMAIL) {
    const lastFail = emailFails[0].createdAt;
    const unlockAt = lastFail.getTime() + LOCK_DURATION_MIN * 60_000;
    const retryAfterSec = Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000));
    if (retryAfterSec > 0) {
      return { allowed: false, reason: "email_locked", retryAfterSec };
    }
  }
  if (ipFails.length >= MAX_FAILS_PER_IP) {
    const lastFail = ipFails[0].createdAt;
    const unlockAt = lastFail.getTime() + LOCK_DURATION_MIN * 60_000;
    const retryAfterSec = Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000));
    if (retryAfterSec > 0) {
      return { allowed: false, reason: "ip_locked", retryAfterSec };
    }
  }
  return { allowed: true };
}

export async function recordLoginAttempt(opts: {
  email: string;
  ip: string;
  userAgent?: string | null;
  success: boolean;
  reason?: string;
}): Promise<void> {
  try {
    await prisma.loginAttempt.create({
      data: {
        email: opts.email.toLowerCase(),
        ip: opts.ip,
        userAgent: opts.userAgent ?? null,
        success: opts.success,
        reason: opts.reason ?? null
      }
    });
  } catch (e: any) {
    // No queremos romper login porque audit falle.
    console.warn("[login-throttle] no se pudo registrar intento:", e?.message ?? e);
  }
}

/** Extrae IP desde headers de NextRequest o req nativo. */
export function ipFromHeaders(headers: Headers | Record<string, string | string[] | undefined> | undefined): string {
  if (!headers) return "unknown";
  const get = (k: string): string | undefined => {
    if (headers instanceof Headers) return headers.get(k) ?? undefined;
    const v = headers[k] ?? headers[k.toLowerCase()];
    if (Array.isArray(v)) return v[0];
    return v;
  };
  const fwd = get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = get("x-real-ip");
  if (real) return real;
  return "unknown";
}
