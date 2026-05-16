/**
 * Sync engine bidireccional entre CalendarEvent (Hub) y Google
 * Calendar. Funciones:
 *
 *   - pullForConnection(conn): trae cambios de Google → CalendarEvent.
 *     Idempotente (usa googleEventId como clave única). Si el syncToken
 *     ha caducado, hace full sync. Crea, actualiza o borra según
 *     status="cancelled".
 *
 *   - pushEventToGoogle(event, conn): empuja un evento del Hub a
 *     Google. Si el event ya tenía googleEventId hace PATCH; si no
 *     hace INSERT y guarda el id devuelto.
 *
 *   - deleteEventInGoogle(event, conn): borra remoto si googleEventId
 *     existe.
 *
 * Evitar loops: cada vez que el cron PULL crea/actualiza un evento,
 * grabamos `lastSyncedAt = now`. Si justo después llega un PATCH
 * desde el endpoint del Hub para el mismo evento, el endpoint verá
 * que el campo no ha cambiado y no propaga. Para casos límite
 * (cambios concurrentes), aceptamos que el último escritor gane.
 */

import { prisma } from "@/lib/db/prisma";
import {
  deleteEvent as gcalDelete,
  insertEvent as gcalInsert,
  listEventsIncremental,
  patchEvent as gcalPatch,
  type GCalEvent
} from "./client";
import type { CalendarEvent, GoogleCalendarConnection } from "@prisma/client";

export type SyncResult = {
  created: number;
  updated: number;
  deleted: number;
  resetRequired: boolean;
};

/**
 * PULL: lee cambios de Google y los aplica al Hub.
 */
export async function pullForConnection(
  conn: GoogleCalendarConnection
): Promise<SyncResult> {
  if (!conn.pullEnabled) return { created: 0, updated: 0, deleted: 0, resetRequired: false };

  let result: SyncResult = { created: 0, updated: 0, deleted: 0, resetRequired: false };
  try {
    const { events, newSyncToken, resetRequired } = await listEventsIncremental(conn, conn.syncToken);
    if (resetRequired) {
      // Borra syncToken y deja que la próxima ejecución haga full.
      await prisma.googleCalendarConnection.update({
        where: { id: conn.id },
        data: { syncToken: null, lastError: "syncToken expirado: full sync en próxima ejecución" }
      });
      return { ...result, resetRequired: true };
    }

    for (const e of events) {
      if (e.status === "cancelled") {
        const del = await prisma.calendarEvent.deleteMany({
          where: {
            workspaceId: conn.workspaceId,
            googleCalendarId: conn.calendarId,
            googleEventId: e.id
          }
        });
        result.deleted += del.count;
        continue;
      }
      const mapped = mapGoogleToCalendarEvent(e);
      const existing = await prisma.calendarEvent.findFirst({
        where: { googleCalendarId: conn.calendarId, googleEventId: e.id },
        select: { id: true }
      });
      if (existing) {
        await prisma.calendarEvent.update({
          where: { id: existing.id },
          data: { ...mapped, lastSyncedAt: new Date() }
        });
        result.updated++;
      } else {
        await prisma.calendarEvent.create({
          data: {
            workspaceId: conn.workspaceId,
            googleCalendarId: conn.calendarId,
            googleEventId: e.id,
            googleOwnerUserId: conn.userId,
            lastSyncedAt: new Date(),
            ...mapped
          }
        });
        result.created++;
      }
    }

    await prisma.googleCalendarConnection.update({
      where: { id: conn.id },
      data: {
        syncToken: newSyncToken,
        lastSyncedAt: new Date(),
        lastError: null
      }
    });
  } catch (e: any) {
    await prisma.googleCalendarConnection.update({
      where: { id: conn.id },
      data: { lastError: String(e?.message ?? e).slice(0, 500) }
    });
    throw e;
  }
  return result;
}

/**
 * PUSH: crea o actualiza un evento del Hub en Google.
 */
export async function pushEventToGoogle(
  event: CalendarEvent,
  conn: GoogleCalendarConnection
): Promise<void> {
  if (!conn.pushEnabled) return;
  const body = mapCalendarEventToGoogle(event);
  try {
    if (event.googleEventId && event.googleCalendarId === conn.calendarId) {
      await gcalPatch(conn, event.googleEventId, body);
      await prisma.calendarEvent.update({
        where: { id: event.id },
        data: { lastSyncedAt: new Date() }
      });
    } else {
      const created = await gcalInsert(conn, body);
      await prisma.calendarEvent.update({
        where: { id: event.id },
        data: {
          googleEventId: created.id,
          googleCalendarId: conn.calendarId,
          googleOwnerUserId: conn.userId,
          lastSyncedAt: new Date()
        }
      });
    }
  } catch (e: any) {
    console.warn("[gcal push] event", event.id, e?.message ?? e);
  }
}

/**
 * PUSH DELETE: borra el evento en Google si existía allí.
 */
export async function deleteEventInGoogle(
  event: { googleEventId: string | null; googleCalendarId: string | null },
  conn: GoogleCalendarConnection
): Promise<void> {
  if (!conn.pushEnabled) return;
  if (!event.googleEventId || event.googleCalendarId !== conn.calendarId) return;
  try {
    await gcalDelete(conn, event.googleEventId);
  } catch (e: any) {
    console.warn("[gcal delete] event", event.googleEventId, e?.message ?? e);
  }
}

// ---- Mapping helpers ----

function mapGoogleToCalendarEvent(e: GCalEvent): {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
} {
  const allDay = !!e.start.date && !e.start.dateTime;
  const start = allDay
    ? new Date(`${e.start.date}T00:00:00Z`)
    : new Date(e.start.dateTime!);
  const end = allDay
    ? e.end.date
      ? new Date(`${e.end.date}T00:00:00Z`)
      : null
    : e.end.dateTime
      ? new Date(e.end.dateTime)
      : null;
  return {
    title: e.summary?.slice(0, 200) || "(sin título)",
    description: e.description ?? null,
    startAt: start,
    endAt: end,
    allDay
  };
}

function mapCalendarEventToGoogle(event: CalendarEvent): Partial<GCalEvent> {
  if (event.allDay) {
    const startDate = isoDate(event.startAt);
    // En Google all-day, end.date es EXCLUSIVO: si end es el mismo día,
    // tenemos que sumar 1.
    const endIso = event.endAt ?? event.startAt;
    const endDate = isoDate(addDays(endIso, event.endAt ? 0 : 1));
    return {
      summary: event.title,
      description: event.description ?? undefined,
      start: { date: startDate },
      end: { date: endDate }
    };
  }
  return {
    summary: event.title,
    description: event.description ?? undefined,
    start: { dateTime: event.startAt.toISOString() },
    end: {
      dateTime: (event.endAt ?? new Date(event.startAt.getTime() + 60 * 60 * 1000)).toISOString()
    }
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/**
 * Helper para usarse desde los endpoints de eventos: encuentra la
 * conexión activa del owner (si la hay) y lanza el push. Si no hay
 * conexión, no hace nada.
 */
export async function pushEventIfConnected(eventId: string): Promise<void> {
  const event = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
  if (!event) return;
  // Si el evento ya tiene googleOwnerUserId, usamos esa conexión. Si
  // no (evento creado en el Hub), buscamos cualquier conexión activa
  // del workspace; preferimos al creador del evento si lo tenemos
  // ligado. En v1 simplemente cogemos la primera conexión del
  // workspace — más adelante se puede ampliar a "calendar por user".
  const conn = event.googleOwnerUserId
    ? await prisma.googleCalendarConnection.findUnique({
        where: {
          userId_workspaceId: { userId: event.googleOwnerUserId, workspaceId: event.workspaceId }
        }
      })
    : await prisma.googleCalendarConnection.findFirst({
        where: { workspaceId: event.workspaceId, pushEnabled: true }
      });
  if (!conn) return;
  await pushEventToGoogle(event, conn);
}
