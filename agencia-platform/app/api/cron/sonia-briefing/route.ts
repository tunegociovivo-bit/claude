/**
 * Cron del "briefing proactivo de Sonia": una vez al día (p.ej. 8:00),
 * crea para cada miembro una notificación + push con lo importante del
 * día: tareas que vencen / atrasadas, eventos de hoy y reseñas de Google
 * sin responder.
 *
 * Seguridad: header `Authorization: Bearer ${CRON_SECRET}` o ?secret=…
 * Idempotencia: una notificación tipo "sonia_briefing" por usuario y día.
 *
 * El timing (la hora) lo decide el programador externo (Railway cron /
 * GitHub Actions); aquí solo procesamos al ser invocados.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/web-push";

export const dynamic = "force-dynamic";

function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if ((req.headers.get("authorization") ?? "") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const memberships = await prisma.membership.findMany({
    select: { userId: true, workspaceId: true }
  });

  // Caché por workspace de los datos compartidos (eventos hoy + reseñas).
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
    // Idempotencia: ya enviado hoy.
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

    // Si no hay nada reseñable, no molestamos.
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
    sendPushToUser(m.userId, { title: "Tu resumen del día", body, link: "/", tag: "sonia-briefing" }).catch(
      (e) => console.warn("[push] briefing:", e?.message ?? e)
    );
    sent++;
  }

  return NextResponse.json({ ok: true, membershipsChecked: memberships.length, briefingsSent: sent });
}
