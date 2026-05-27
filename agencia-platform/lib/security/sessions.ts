/**
 * Tracking de sesiones manuales. NextAuth usa JWT (no guarda Session
 * en BD), pero queremos poder LISTAR y REVOCAR sesiones desde
 * /perfil/seguridad. Solución: a cada login añadimos un sid único a
 * la JWT y creamos una fila en UserSession con metadatos. En cada
 * request autenticado, comprobamos que la sid sigue viva (no
 * revokedAt). Si no, rechazamos el request.
 *
 * El parseo del user-agent es muy simple — no merece la pena meter
 * ua-parser-js para esto, queremos solo distinguir "Chrome en Mac"
 * de "Safari iOS" para el listado.
 */

import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";

const SESSION_DURATION_DAYS = 30;

export function generateSid(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function parseDeviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Desconocido";
  const ua = userAgent;
  // Detección OS
  let os = "—";
  if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Mac OS X/i.test(ua)) os = "Mac";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad/i.test(ua)) os = "iOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  // Detección navegador
  let browser = "navegador";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  return `${browser} en ${os}`;
}

export async function createSession(opts: {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<string> {
  const sid = generateSid();
  await prisma.userSession.create({
    data: {
      userId: opts.userId,
      sid,
      deviceLabel: parseDeviceLabel(opts.userAgent),
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      expiresAt: new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 3600_000)
    }
  });
  return sid;
}

/**
 * Comprueba si una sid sigue siendo válida. Devuelve true si vive
 * y no está revocada; refresca lastSeenAt como side-effect (best-effort).
 * Pensado para llamarse en cada request autenticado.
 */
export async function touchSession(sid: string | undefined | null): Promise<boolean> {
  if (!sid) return false;
  const sess = await prisma.userSession.findUnique({
    where: { sid },
    select: { revokedAt: true, expiresAt: true }
  });
  if (!sess) return false;
  if (sess.revokedAt) return false;
  if (sess.expiresAt < new Date()) return false;
  // Best-effort: actualizamos lastSeenAt sin esperar. Si falla no
  // rompe el flujo.
  prisma.userSession
    .update({ where: { sid }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
  return true;
}

export async function revokeSession(
  userId: string,
  sid: string,
  reason: "logout" | "user_revoked" | "admin_revoked" | "password_changed" = "user_revoked"
): Promise<boolean> {
  const r = await prisma.userSession.updateMany({
    where: { userId, sid, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason }
  });
  return r.count > 0;
}

export async function revokeAllOtherSessions(userId: string, keepSid: string): Promise<number> {
  const r = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null, NOT: { sid: keepSid } },
    data: { revokedAt: new Date(), revokedReason: "user_revoked" }
  });
  return r.count;
}

export async function listSessions(userId: string, currentSid: string | null) {
  const rows = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" }
  });
  return rows.map((r) => ({
    id: r.id,
    sid: r.sid,
    deviceLabel: r.deviceLabel,
    ip: r.ip,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    current: r.sid === currentSid
  }));
}
