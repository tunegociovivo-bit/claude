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
import type { CalendarEvent, GoogleCalendarConnection, Task } from "@prisma/client";

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
      // Si el evento de Google es el ESPEJO de una tarea del Hub (push
      // Hub→Google de tareas con fecha), NO lo reimportamos como evento de
      // calendario: evita duplicados y bucles. La tarea es la fuente de verdad.
      const taskMirror = await prisma.task.findFirst({
        where: { googleCalendarId: conn.calendarId, googleEventId: e.id ?? "__none__" },
        select: { id: true }
      });
      if (taskMirror) continue;
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

/** Borra en Google (si está sincronizado) el evento indicado. No-op si no
 *  hay conexión activa o el evento no estaba en Google. */
export async function deleteEventIfConnected(event: {
  id: string;
  workspaceId: string;
  googleEventId: string | null;
  googleCalendarId: string | null;
  googleOwnerUserId: string | null;
}): Promise<void> {
  if (!event.googleEventId) return;
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
  await deleteEventInGoogle(event, conn);
}

// ===========================================================================
//  TAREAS → Google Calendar (push). Las tareas del kanban con fecha (dueDate)
//  se reflejan como eventos en el Google Calendar del usuario conectado. Es
//  one-way (el Hub manda): el pull ignora estos eventos espejo (ver guard en
//  pullForConnection) para no duplicarlos como CalendarEvent.
// ===========================================================================

function mapTaskToGoogle(task: Task): Partial<GCalEvent> {
  const summary = `📋 ${task.title}`.slice(0, 240);
  const description = "Tarea de Negocio Vivo Hub";
  const due = task.dueDate as Date;
  if (task.dueAllDay) {
    return {
      summary,
      description,
      start: { date: isoDate(due) },
      end: { date: isoDate(addDays(due, 1)) } // end.date exclusivo en Google
    };
  }
  return {
    summary,
    description,
    start: { dateTime: due.toISOString() },
    end: { dateTime: new Date(due.getTime() + 60 * 60 * 1000).toISOString() }
  };
}

/** Crea/actualiza el evento espejo de una tarea en Google. */
export async function pushTaskToGoogle(task: Task, conn: GoogleCalendarConnection): Promise<void> {
  if (!conn.pushEnabled || !task.dueDate) return;
  const body = mapTaskToGoogle(task);
  try {
    if (task.googleEventId && task.googleCalendarId === conn.calendarId) {
      await gcalPatch(conn, task.googleEventId, body);
      await prisma.task.update({ where: { id: task.id }, data: { gcalSyncedAt: new Date() } });
    } else {
      const created = await gcalInsert(conn, body);
      await prisma.task.update({
        where: { id: task.id },
        data: {
          googleEventId: created.id,
          googleCalendarId: conn.calendarId,
          googleOwnerUserId: conn.userId,
          gcalSyncedAt: new Date()
        }
      });
    }
  } catch (e: any) {
    console.warn("[gcal push] task", task.id, e?.message ?? e);
  }
}

/** Borra el evento espejo de una tarea en Google y desvincula la tarea. */
export async function deleteTaskInGoogle(
  task: { id: string; googleEventId: string | null; googleCalendarId: string | null },
  conn: GoogleCalendarConnection
): Promise<void> {
  if (task.googleEventId && task.googleCalendarId === conn.calendarId) {
    try {
      await gcalDelete(conn, task.googleEventId);
    } catch (e: any) {
      console.warn("[gcal delete] task", task.googleEventId, e?.message ?? e);
    }
  }
  await prisma.task
    .update({
      where: { id: task.id },
      data: { googleEventId: null, googleCalendarId: null, googleOwnerUserId: null, gcalSyncedAt: null }
    })
    .catch(() => {});
}

/** Push instantáneo al crear/editar una tarea. Si la tarea ya no tiene fecha,
 *  está completada o en papelera, borra su espejo en Google. */
export async function pushTaskIfConnected(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  const conn = task.googleOwnerUserId
    ? await prisma.googleCalendarConnection.findUnique({
        where: { userId_workspaceId: { userId: task.googleOwnerUserId, workspaceId: task.workspaceId } }
      })
    : await prisma.googleCalendarConnection.findFirst({
        where: { workspaceId: task.workspaceId, pushEnabled: true }
      });
  if (!conn) return;
  if (!task.dueDate || task.completedAt || task.deletedAt) {
    await deleteTaskInGoogle(task, conn);
    return;
  }
  await pushTaskToGoogle(task, conn);
}

/** Backfill/sync periódico de tareas para una conexión (lo llama el cron y el
 *  callback al conectar). Empuja las tareas con fecha pendientes de sincronizar
 *  y borra los espejos de las que ya están completadas / sin fecha. */
export async function pushPendingTasksForConnection(
  conn: GoogleCalendarConnection
): Promise<{ pushed: number; deleted: number }> {
  if (!conn.pushEnabled) return { pushed: 0, deleted: 0 };
  const windowStart = new Date(Date.now() - 30 * 86_400_000); // hasta 30 días atrás

  // 1) Crear/actualizar: tareas con fecha, activas, de esta conexión (o sin dueño aún).
  const tasks = await prisma.task.findMany({
    where: {
      workspaceId: conn.workspaceId,
      deletedAt: null,
      completedAt: null,
      dueDate: { gte: windowStart },
      OR: [{ googleEventId: null }, { googleOwnerUserId: conn.userId }]
    },
    orderBy: { dueDate: "asc" },
    take: 400
  });
  let pushed = 0;
  for (const t of tasks) {
    // Salta si ya está al día (sincronizada después de la última edición).
    if (t.googleEventId && t.gcalSyncedAt && t.gcalSyncedAt >= t.updatedAt) continue;
    await pushTaskToGoogle(t, conn);
    pushed++;
  }

  // 2) Borrar espejo de tareas que dejaron de cumplir condiciones.
  const stale = await prisma.task.findMany({
    where: {
      workspaceId: conn.workspaceId,
      googleOwnerUserId: conn.userId,
      googleEventId: { not: null },
      OR: [{ completedAt: { not: null } }, { dueDate: null }, { deletedAt: { not: null } }]
    },
    take: 400
  });
  let deleted = 0;
  for (const t of stale) {
    await deleteTaskInGoogle(t, conn);
    deleted++;
  }
  return { pushed, deleted };
}
