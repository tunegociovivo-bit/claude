/**
 * Cliente del Google Calendar API. Llamada HTTP directa, sin SDK
 * pesado. Refresca el access_token automáticamente si está caducado
 * o si Google nos devuelve 401.
 *
 * Solo expone lo que necesita el sync engine: listar (con syncToken),
 * insertar, actualizar y borrar eventos. Si después hacen falta más
 * features (recordatorios, attendees, recurrencia), se amplía aquí.
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret, encryptSecret } from "@/lib/ai/crypto";
import { refreshAccessToken } from "./oauth";
import type { GoogleCalendarConnection } from "@prisma/client";

const BASE = "https://www.googleapis.com/calendar/v3";

/**
 * Devuelve un access_token válido. Si está expirado, refresca contra
 * Google y persiste el nuevo en BD.
 */
export async function getFreshAccessToken(conn: GoogleCalendarConnection): Promise<string> {
  const accessToken = decryptSecret(conn.accessTokenEnc);
  if (!accessToken) throw new Error("Token cifrado corrupto");
  const expiresInMs = conn.expiresAt.getTime() - Date.now();
  if (expiresInMs > 60_000) return accessToken; // todavía vale al menos 1 min

  const refreshToken = decryptSecret(conn.refreshTokenEnc);
  if (!refreshToken) throw new Error("Refresh token cifrado corrupto");
  const fresh = await refreshAccessToken(refreshToken);
  await prisma.googleCalendarConnection.update({
    where: { id: conn.id },
    data: {
      accessTokenEnc: encryptSecret(fresh.access_token),
      expiresAt: new Date(Date.now() + fresh.expires_in * 1000)
    }
  });
  return fresh.access_token;
}

async function gcalFetch(
  conn: GoogleCalendarConnection,
  path: string,
  init: RequestInit & { retried?: boolean } = {}
): Promise<Response> {
  const token = await getFreshAccessToken(conn);
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const r = await fetch(`${BASE}${path}`, { ...init, headers });
  // Auto-retry una vez si 401 (token caducó durante la request).
  if (r.status === 401 && !init.retried) {
    // Forzar refresh marcando expiresAt como pasado.
    await prisma.googleCalendarConnection.update({
      where: { id: conn.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });
    return gcalFetch(conn, path, { ...init, retried: true });
  }
  return r;
}

export type GCalEvent = {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  htmlLink?: string;
  updated: string;
};

type ListResponse = {
  items: GCalEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

/**
 * Lista eventos con paginación + sync incremental. Si pasamos
 * `syncToken`, Google solo nos devolverá los cambios desde la última
 * llamada (incluyendo eventos cancelados). Si el token está caducado
 * (>30 días sin uso o cambio de permisos), Google responde 410 GONE
 * y aquí lo marcamos para que el caller haga full sync.
 */
export async function listEventsIncremental(
  conn: GoogleCalendarConnection,
  syncToken: string | null
): Promise<{ events: GCalEvent[]; newSyncToken: string | null; resetRequired: boolean }> {
  const calendarId = encodeURIComponent(conn.calendarId);
  const events: GCalEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  let resetRequired = false;
  let usedSyncToken = syncToken;

  // Si no tenemos syncToken, hacemos full sync limitado a una ventana
  // razonable (los próximos 90 días). Una semana atrás para reflejar
  // cambios recientes a eventos pasados.
  const baseParams: Record<string, string> = usedSyncToken
    ? { syncToken: usedSyncToken }
    : {
        timeMin: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        timeMax: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        singleEvents: "true",
        showDeleted: "false"
      };

  // Loop de paginación
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({ ...baseParams, ...(pageToken ? { pageToken } : {}) });
    const r = await gcalFetch(conn, `/calendars/${calendarId}/events?${params.toString()}`);
    if (r.status === 410) {
      // syncToken caducado, full sync requerido en próxima ejecución.
      return { events: [], newSyncToken: null, resetRequired: true };
    }
    if (!r.ok) throw new Error(`Google list eventos ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data: ListResponse = await r.json();
    events.push(...data.items);
    if (data.nextPageToken) {
      pageToken = data.nextPageToken;
      continue;
    }
    nextSyncToken = data.nextSyncToken ?? null;
    break;
  }
  return { events, newSyncToken: nextSyncToken, resetRequired };
}

export async function insertEvent(
  conn: GoogleCalendarConnection,
  body: Partial<GCalEvent>
): Promise<GCalEvent> {
  const calendarId = encodeURIComponent(conn.calendarId);
  const r = await gcalFetch(conn, `/calendars/${calendarId}/events`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Google insert ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function patchEvent(
  conn: GoogleCalendarConnection,
  eventId: string,
  body: Partial<GCalEvent>
): Promise<GCalEvent> {
  const calendarId = encodeURIComponent(conn.calendarId);
  const r = await gcalFetch(conn, `/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Google patch ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function deleteEvent(conn: GoogleCalendarConnection, eventId: string): Promise<void> {
  const calendarId = encodeURIComponent(conn.calendarId);
  const r = await gcalFetch(conn, `/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE"
  });
  // 404 / 410 = ya borrado en Google, lo damos por bueno.
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    throw new Error(`Google delete ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}
