/**
 * Lógica de los trabajos periódicos, extraída para poder ejecutarla desde
 * (a) los endpoints HTTP (GitHub Actions / Railway / disparo manual) y
 * (b) el planificador interno de la app (instrumentation.ts), que NO
 * necesita cron externo ni tokens.
 *
 * Todo es idempotente: se puede llamar de más sin efectos duplicados.
 */
import { prisma } from "@/lib/db/prisma";

// web-push (y sus deps: agent-base/https-proxy-agent → http/https/net) son
// solo de Node. Lo importamos DINÁMICO dentro de las funciones para que no
// entre en el grafo estático que analiza Next (instrumentation/edge), que
// rompía el build con "Can't resolve 'http'/'https'/'net'".
type PushFn = (
  userId: string,
  payload: { title: string; body: string; link?: string; tag?: string }
) => Promise<unknown>;
async function getSendPush(): Promise<PushFn> {
  const m = await import("@/lib/push/web-push");
  return m.sendPushToUser as unknown as PushFn;
}

/**
 * Recordatorios: tareas que vencen en 24h + eventos del calendario que
 * empiezan en los próximos 30 min (push una sola vez por evento).
 */
export async function runReminders(): Promise<{
  tasksChecked: number;
  notificationsCreated: number;
  eventsChecked: number;
  eventReminders: number;
}> {
  const sendPushToUser = await getSendPush();
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const tasksDue = await prisma.task.findMany({
    where: { dueDate: { gte: now, lte: tomorrow }, status: { notIn: ["DONE", "CANCELLED"] } },
    select: { id: true, title: true, dueDate: true, assignees: { select: { userId: true } } }
  });

  let created = 0;
  for (const task of tasksDue) {
    const dueStr = task.dueDate
      ? task.dueDate.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : "";
    const body = `Tu tarea "${task.title}" vence el ${dueStr}`;
    for (const a of task.assignees) {
      const existing = await prisma.notification.findFirst({
        where: { userId: a.userId, type: "deadline", body }
      });
      if (existing) continue;
      const link = `/tareas?task=${task.id}`;
      await prisma.notification.create({ data: { userId: a.userId, type: "deadline", body, link } });
      sendPushToUser(a.userId, { title: "Vence pronto", body, link, tag: `deadline-${task.id}` }).catch((e) =>
        console.warn("[push] deadline fallo:", e?.message ?? e)
      );
      created++;
    }
  }

  // Recordatorios de eventos del calendario (citas/reservas).
  const soon = new Date(now.getTime() + 30 * 60 * 1000);
  const events = await prisma.calendarEvent.findMany({
    where: { startAt: { gte: now, lte: soon }, allDay: false, reminderSentAt: null },
    select: { id: true, title: true, startAt: true, workspaceId: true }
  });
  let eventReminders = 0;
  const membersByWs = new Map<string, string[]>();
  for (const ev of events) {
    let members = membersByWs.get(ev.workspaceId);
    if (!members) {
      const ms = await prisma.membership.findMany({
        where: { workspaceId: ev.workspaceId },
        select: { userId: true }
      });
      members = ms.map((m) => m.userId);
      membersByWs.set(ev.workspaceId, members);
    }
    const hhmm = ev.startAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    const body = `Próximo evento a las ${hhmm}: ${ev.title}`;
    for (const userId of members) {
      await prisma.notification
        .create({ data: { userId, type: "event_reminder", body, link: "/calendario" } })
        .catch(() => {});
      sendPushToUser(userId, {
        title: "Recordatorio de evento",
        body,
        link: "/calendario",
        tag: `event-${ev.id}`
      }).catch((e) => console.warn("[push] event reminder:", e?.message ?? e));
      eventReminders++;
    }
    await prisma.calendarEvent
      .update({ where: { id: ev.id }, data: { reminderSentAt: new Date() } })
      .catch(() => {});
  }

  return {
    tasksChecked: tasksDue.length,
    notificationsCreated: created,
    eventsChecked: events.length,
    eventReminders
  };
}

/**
 * Briefing diario: una notificación + push por usuario con tareas que
 * vencen/atrasadas, eventos de hoy y reseñas GMB sin responder.
 * Idempotente: una por usuario y día (type "sonia_briefing").
 */
export async function runBriefing(): Promise<{ membershipsChecked: number; briefingsSent: number }> {
  const sendPushToUser = await getSendPush();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const memberships = await prisma.membership.findMany({ select: { userId: true, workspaceId: true } });

  const wsCache = new Map<string, { events: { title: string; at: Date }[]; gmbPending: number }>();
  async function wsData(workspaceId: string) {
    let d = wsCache.get(workspaceId);
    if (d) return d;
    const events = await prisma.calendarEvent.findMany({
      where: { workspaceId, startAt: { gte: today, lt: tomorrow } },
      select: { title: true, startAt: true },
      orderBy: { startAt: "asc" },
      take: 8
    });
    let gmbPending = 0;
    try {
      gmbPending = await prisma.gmbReview.count({
        where: { workspaceId, OR: [{ reviewReply: null }, { reviewReply: "" }] }
      });
    } catch {
      /* GMB sin datos */
    }
    d = { events: events.map((e) => ({ title: e.title, at: e.startAt })), gmbPending };
    wsCache.set(workspaceId, d);
    return d;
  }

  let sent = 0;
  for (const m of memberships) {
    const already = await prisma.notification.findFirst({
      where: { userId: m.userId, type: "sonia_briefing", createdAt: { gte: today } }
    });
    if (already) continue;

    const [dueToday, overdue] = await Promise.all([
      prisma.task.count({
        where: {
          workspaceId: m.workspaceId,
          assignees: { some: { userId: m.userId } },
          status: { notIn: ["DONE", "CANCELLED"] },
          dueDate: { gte: today, lt: tomorrow }
        }
      }),
      prisma.task.count({
        where: {
          workspaceId: m.workspaceId,
          assignees: { some: { userId: m.userId } },
          status: { notIn: ["DONE", "CANCELLED"] },
          dueDate: { lt: today }
        }
      })
    ]);

    const { events, gmbPending } = await wsData(m.workspaceId);
    if (dueToday === 0 && overdue === 0 && events.length === 0 && gmbPending === 0) continue;

    const parts: string[] = [];
    if (dueToday > 0) parts.push(`${dueToday} tarea${dueToday > 1 ? "s" : ""} vence${dueToday > 1 ? "n" : ""} hoy`);
    if (overdue > 0) parts.push(`${overdue} atrasada${overdue > 1 ? "s" : ""}`);
    if (events.length > 0) {
      const evList = events
        .slice(0, 3)
        .map((e) => `${e.title} (${e.at.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })})`)
        .join(", ");
      parts.push(`📅 ${events.length} evento${events.length > 1 ? "s" : ""}: ${evList}`);
    }
    if (gmbPending > 0) parts.push(`⭐ ${gmbPending} reseña${gmbPending > 1 ? "s" : ""} de Google sin responder`);

    const body = `☀️ Buenos días. ${parts.join(" · ")}.`;
    await prisma.notification
      .create({ data: { userId: m.userId, type: "sonia_briefing", body, link: "/" } })
      .catch(() => {});
    sendPushToUser(m.userId, { title: "Tu resumen del día", body, link: "/", tag: "sonia-briefing" }).catch((e) =>
      console.warn("[push] briefing:", e?.message ?? e)
    );
    sent++;
  }

  return { membershipsChecked: memberships.length, briefingsSent: sent };
}
