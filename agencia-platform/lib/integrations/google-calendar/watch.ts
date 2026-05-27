/**
 * Watch channels de Google Calendar: suscripciones push para que
 * Google nos avise por webhook cuando hay cambios, en lugar de
 * tener que hacer polling cada 15 min.
 *
 * Requisitos del lado de Google:
 *   1. La URL del webhook debe estar verificada en Google Search
 *      Console por el proyecto de Google Cloud (DNS TXT o meta tag).
 *   2. Debe ser HTTPS público (no localhost).
 *
 * Si la verificación no está hecha, watch() falla con 401 y el
 * sistema sigue funcionando con polling. Avisamos al user en la UI.
 *
 * Vida útil del canal: máximo 30 días (Google decide). Renovamos
 * cada 24h cualquier canal que expire en <48h via /api/cron/calendar-watch-renew.
 */

import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getFreshAccessToken } from "./client";
import type { GoogleCalendarConnection } from "@prisma/client";

const TARGET_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días (límite Google)

function webhookUrl(): string {
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  return `${base}/api/integrations/google-calendar/webhook`;
}

/**
 * Registra un nuevo canal de notificación para esta conexión.
 * Llama a Google /calendars/{id}/events/watch y persiste lo que
 * Google devuelve. Si ya había un canal vivo, lo dejamos: Google
 * permite varios canales por recurso, el cron de renovación se
 * encargará de limpiar los expirados.
 */
export async function createWatchForConnection(
  conn: GoogleCalendarConnection
): Promise<{ ok: true; channelId: string; expiration: Date } | { ok: false; reason: string }> {
  const token = await getFreshAccessToken(conn);
  const channelId = crypto.randomUUID();
  const channelToken = crypto.randomBytes(24).toString("hex");
  const expiration = Date.now() + TARGET_TTL_MS;

  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(conn.calendarId)}/events/watch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl(),
        token: channelToken,
        expiration: String(expiration)
      })
    }
  );

  if (!r.ok) {
    const txt = (await r.text()).slice(0, 300);
    return { ok: false, reason: `Google watch ${r.status}: ${txt}` };
  }
  const data = await r.json();
  // resourceId es necesario para channels.stop. expiration que devuelve
  // Google puede ser menor que el que pedimos.
  await prisma.googleCalendarWatchChannel.create({
    data: {
      connectionId: conn.id,
      channelId,
      token: channelToken,
      resourceId: data.resourceId,
      expiration: new Date(Number(data.expiration ?? expiration))
    }
  });
  return { ok: true, channelId, expiration: new Date(Number(data.expiration ?? expiration)) };
}

/**
 * Cierra el canal en Google y borra el registro local. Llamar al
 * desconectar la cuenta o al renovar (donde se crea uno nuevo y se
 * cierra el viejo).
 */
export async function stopWatch(channelDbId: string): Promise<void> {
  const ch = await prisma.googleCalendarWatchChannel.findUnique({
    where: { id: channelDbId },
    include: { connection: true }
  });
  if (!ch) return;
  try {
    const token = await getFreshAccessToken(ch.connection);
    await fetch("https://www.googleapis.com/calendar/v3/channels/stop", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: ch.channelId, resourceId: ch.resourceId })
    }).catch(() => {});
  } finally {
    await prisma.googleCalendarWatchChannel.delete({ where: { id: channelDbId } }).catch(() => {});
  }
}

/**
 * Borra todos los canales asociados a una conexión (al desconectar).
 */
export async function stopAllWatchesForConnection(connectionId: string): Promise<void> {
  const channels = await prisma.googleCalendarWatchChannel.findMany({
    where: { connectionId }
  });
  await Promise.all(channels.map((c) => stopWatch(c.id)));
}

/**
 * Renueva canales que expiran pronto: cierra el viejo y crea uno
 * nuevo. "Pronto" = menos de RENEW_BEFORE_MS (48h por defecto).
 */
const RENEW_BEFORE_MS = 48 * 60 * 60 * 1000;

export async function renewExpiringWatches(): Promise<{
  renewed: number;
  failed: number;
  details: Array<{ connectionId: string; ok: boolean; reason?: string }>;
}> {
  const expiringBefore = new Date(Date.now() + RENEW_BEFORE_MS);
  const channels = await prisma.googleCalendarWatchChannel.findMany({
    where: { expiration: { lt: expiringBefore } },
    include: { connection: true }
  });
  let renewed = 0;
  let failed = 0;
  const details = [];
  for (const ch of channels) {
    const result = await createWatchForConnection(ch.connection);
    if (result.ok) {
      await stopWatch(ch.id);
      renewed++;
      details.push({ connectionId: ch.connectionId, ok: true });
    } else {
      failed++;
      details.push({ connectionId: ch.connectionId, ok: false, reason: result.reason });
    }
  }
  return { renewed, failed, details };
}
