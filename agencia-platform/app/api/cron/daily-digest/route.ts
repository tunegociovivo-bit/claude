/**
 * Cron de "resumen diario" — manda a cada miembro con email un
 * digest con sus pendientes del día. Pensado para correr una vez al
 * día, sobre las 07:30 hora local. El timing exacto lo determina
 * el caller (GitHub Actions / Railway cron); aquí dentro no
 * intentamos adivinarlo, solo procesamos al ser invocados.
 *
 * Seguridad idéntica al cron de task-notifications: header
 *   Authorization: Bearer ${CRON_SECRET}
 * o ?secret=... para invocaciones manuales.
 *
 * Idempotencia: usamos una "marca" virtual basada en la fecha (YYYY-
 * MM-DD) en la tabla TaskNotificationSent con ruleKey="daily_digest"
 * y taskId="DIGEST". Si la fila para (DIGEST, daily_digest:YYYY-MM-DD,
 * userId) ya existe ese día, no se reenvía.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isEmailEnabled, sendEmail } from "@/lib/integrations/email";
import { cronAuthOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

async function authorize(req: Request): Promise<boolean> {
  return cronAuthOk(req);
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isEmailEnabled()) {
    return NextResponse.json(
      { error: "email_not_configured", hint: "Define RESEND_API_KEY" },
      { status: 503 }
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(today);
  dayAfter.setDate(dayAfter.getDate() + 2);

  const dateKey = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const ruleKey = `daily_digest:${dateKey}`;

  // Todos los usuarios con email + membership activa
  const users = await prisma.user.findMany({
    where: { memberships: { some: {} } },
    select: { id: true, email: true, name: true }
  });

  const sentAcum: string[] = [];
  const skippedAcum: string[] = [];

  for (const u of users) {
    if (!u.email) continue;

    // Ya enviado hoy?
    const already = await prisma.taskNotificationSent.findUnique({
      where: {
        taskId_ruleKey_userId: { taskId: "DIGEST", ruleKey, userId: u.id }
      }
    });
    if (already) {
      skippedAcum.push(u.id);
      continue;
    }

    // Recolección de las 4 secciones
    const [overdue, dueToday, dueTomorrow, mentionsUnread] = await Promise.all([
      prisma.task.findMany({
        where: {
          status: { not: "DONE" },
          assignees: { some: { userId: u.id } },
          dueDate: { lt: today }
        },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: "asc" },
        take: 30
      }),
      prisma.task.findMany({
        where: {
          status: { not: "DONE" },
          assignees: { some: { userId: u.id } },
          dueDate: { gte: today, lt: tomorrow }
        },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: "asc" },
        take: 30
      }),
      prisma.task.findMany({
        where: {
          status: { not: "DONE" },
          assignees: { some: { userId: u.id } },
          dueDate: { gte: tomorrow, lt: dayAfter }
        },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: "asc" },
        take: 30
      }),
      prisma.notification.count({
        where: { userId: u.id, read: false, type: { in: ["mention", "assignment"] } }
      })
    ]);

    const totals = overdue.length + dueToday.length + dueTomorrow.length + mentionsUnread;
    if (totals === 0) {
      // Sin nada que decir → no enviamos email, pero marcamos como
      // "ya procesado hoy" para no consultar otra vez en el mismo día.
      await prisma.taskNotificationSent.create({
        data: { taskId: "DIGEST", ruleKey, userId: u.id }
      });
      skippedAcum.push(u.id);
      continue;
    }

    const html = renderDigestHtml({
      name: u.name ?? u.email.split("@")[0],
      overdue,
      dueToday,
      dueTomorrow,
      mentionsUnread,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? ""
    });

    try {
      await sendEmail({
        to: u.email,
        subject: `Tu día (${dateKey}): ${totals} pendiente${totals === 1 ? "" : "s"}`,
        html
      });
      await prisma.taskNotificationSent.create({
        data: { taskId: "DIGEST", ruleKey, userId: u.id }
      });
      sentAcum.push(u.id);
    } catch (e: any) {
      console.warn("[daily-digest] envío falló:", u.email, e?.message ?? e);
    }
  }

  return NextResponse.json({
    ok: true,
    sent: sentAcum.length,
    skipped: skippedAcum.length,
    date: dateKey
  });
}

type TaskMini = { id: string; title: string; dueDate: Date | null };

function renderDigestHtml(args: {
  name: string;
  overdue: TaskMini[];
  dueToday: TaskMini[];
  dueTomorrow: TaskMini[];
  mentionsUnread: number;
  appUrl: string;
}): string {
  const url = args.appUrl.replace(/\/$/, "");
  const taskLink = (t: TaskMini) => `${url}/tareas?task=${t.id}`;
  const section = (title: string, color: string, tasks: TaskMini[]) => {
    if (tasks.length === 0) return "";
    const rows = tasks
      .map(
        (t) =>
          `<li style="margin:4px 0"><a href="${taskLink(t)}" style="color:#0f172a;text-decoration:none">${escapeHtml(
            t.title
          )}</a>${
            t.dueDate
              ? ` <span style="color:#64748b;font-size:12px"> · ${new Date(t.dueDate).toLocaleDateString(
                  "es-ES",
                  { day: "2-digit", month: "short" }
                )}</span>`
              : ""
          }</li>`
      )
      .join("");
    return `<h3 style="font-size:14px;color:${color};margin:18px 0 6px">${title} (${tasks.length})</h3><ul style="padding-left:18px;margin:0">${rows}</ul>`;
  };

  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;padding:24px;color:#0f172a">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
      <h1 style="font-size:18px;margin:0 0 6px">Buenos días, ${escapeHtml(args.name)}</h1>
      <p style="color:#64748b;margin:0 0 12px;font-size:14px">Esto es lo que tienes hoy.</p>
      ${section("⚠️ Vencidas", "#b91c1c", args.overdue)}
      ${section("📅 Vencen hoy", "#b45309", args.dueToday)}
      ${section("➡️ Vencen mañana", "#0369a1", args.dueTomorrow)}
      ${
        args.mentionsUnread > 0
          ? `<p style="margin:18px 0 0;font-size:14px">💬 Tienes <strong>${args.mentionsUnread}</strong> notificación${
              args.mentionsUnread === 1 ? "" : "es"
            } sin leer. <a href="${url}/mi-dia">Ver Mi día</a></p>`
          : ""
      }
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
      <p style="font-size:12px;color:#94a3b8;margin:0">
        Este resumen se envía una vez al día. Para abrir todo en una pantalla, ve a
        <a href="${url}/mi-dia" style="color:#475569">Mi día</a>.
      </p>
    </div>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
