/**
 * Almacén de nonces one-time para el OAuth de Google Business Profile.
 * Registrar el nonce al iniciar + consumirlo en el callback garantiza un solo uso
 * (anti-replay) además de la firma HMAC y la expiración del propio state.
 *
 * `consumeNonce` es atómico: un updateMany condicionado a usedAt=null; si afecta a
 * 0 filas el nonce ya se usó (o no existe / caducó) → rechazo.
 */
import { prisma } from "@/lib/db/prisma";
import { STATE_TTL_MS } from "./gbp-oauth";

export async function registerNonce(opts: { nonce: string; workspaceId: string; userId: string; now?: number }): Promise<void> {
  const now = opts.now ?? Date.now();
  await prisma.gmbOAuthState.create({
    data: {
      nonce: opts.nonce,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      expiresAt: new Date(now + STATE_TTL_MS),
    },
  });
}

/** Consume el nonce de forma atómica. Devuelve true solo si estaba vigente y sin usar. */
export async function consumeNonce(opts: { nonce: string; workspaceId: string; userId: string; now?: number }): Promise<boolean> {
  const now = new Date(opts.now ?? Date.now());
  const res = await prisma.gmbOAuthState.updateMany({
    where: {
      nonce: opts.nonce,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });
  return res.count === 1;
}

/** Limpieza best-effort de nonces caducados (llamable desde un cron). */
export async function purgeExpiredNonces(now: number = Date.now()): Promise<number> {
  const res = await prisma.gmbOAuthState.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
  return res.count;
}
