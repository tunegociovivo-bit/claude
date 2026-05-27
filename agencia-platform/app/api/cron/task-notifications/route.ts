/**
 * Cron de notificaciones de tarea por email.
 *
 * Debe llamarse cada 5 min (GitHub Actions cron). Recorre las tareas
 * pendientes con dueDate en las próximas 26h y, por cada regla activa
 * (`day_7am`, `1h_before`, `10min_before`), envía email a cada asignado
 * si ya tocó y no se ha enviado todavía.
 *
 * Idempotente vía tabla TaskNotificationSent: si ya existe la fila
 * (taskId, ruleKey, userId) la regla no se reenvía. Esto permite
 * tolerancia frente a reintentos.
 *
 * Seguridad: header `Authorization: Bearer ${CRON_SECRET}` obligatorio
 * (o `?secret=...` para llamadas manuales rápidas). Sin secret en env,
 * el endpoint responde 503 sin trabajar.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isEmailEnabled, sendEmail } from "@/lib/integrations/email";

export const dynamic = "force-dynamic";

type RuleKey = "day_7am" | "1h_before" | "10min_before";
const DEFAULT_RULES: RuleKey[] = ["day_7am", "1h_before", "10min_before"];

// Margen ±X para considerar que una regla ya toca. Como el cron corre
// cada ~5 min, 5min cubre el caso normal; 7 min de holgura para que un
// retraso no haga perder la regla. Se compensa con la deduplicación
// (TaskNotificationSent).
const WINDOW_MIN = 7;

function withinMinutes(target: Date, now: Date, marginMin: number): boolean {
  const diff = target.getTime() - now.getTime();
  return diff >= -marginMin * 60 * 1000 && diff <= marginMin * 60 * 1000;
}

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isEmailEnabled()) {
    return NextResponse.json({ error: "email_not_configured", hint: "Define RESEND_API_KEY" }, { status: 503 });
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + 26 * 60 * 60 * 1000);
  // Sólo tareas no completadas con dueDate en ventana de interés.
  const tasks = await prisma.task.findMany({
    where: {
      dueDate: { gte: new Date(now.getTime() - 60 * 60 * 1000), lte: horizon },
      completedAt: null
    },
    include: {
      assignees: { include: { user: { select: { id: true, email: true, name: true } } } },
      project: { select: { id: true, name: true } }
    }
  });

  type Plan = { taskId: string; ruleKey: RuleKey; userId: string; email: string; name: string | null; title: string; dueAt: Date; project: string | null };
  const plans: Plan[] = [];

  for (const t of tasks) {
    if (!t.dueDate) continue;
    const rules = (Array.isArray((t as any).notifyDueRules) ? (t as any).notifyDueRules : null) ?? DEFAULT_RULES;
    if (rules.length === 0) continue;
    const due = t.dueDate;
    // El cálculo del trigger según la regla. Para day_7am usamos las
    // 07:00 UTC (consistente con cómo guardamos las horas). Para 1h/
    // 10min antes, simple resta a dueDate.
    const triggers: Record<RuleKey, Date> = {
      day_7am: new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate(), 7, 0, 0)),
      "1h_before": new Date(due.getTime() - 60 * 60 * 1000),
      "10min_before": new Date(due.getTime() - 10 * 60 * 1000)
    };
    for (const rule of rules as RuleKey[]) {
      const trig = triggers[rule];
      if (!trig) continue;
      if (!withinMinutes(trig, now, WINDOW_MIN)) continue;
      for (const a of t.assignees) {
        if (!a.user?.email) continue;
        plans.push({
          taskId: t.id,
          ruleKey: rule,
          userId: a.user.id,
          email: a.user.email,
          name: a.user.name,
          title: t.title,
          dueAt: due,
          project: t.project?.name ?? null
        });
      }
    }
  }

  let sent = 0;
  let skipped = 0;
  const errors: { taskId: string; ruleKey: string; userId: string; msg: string }[] = [];

  for (const p of plans) {
    // Insertar primero la marca de "enviado" — si la fila ya existe
    // (otro run del cron), saltamos. Si la inserción funciona pero el
    // email falla, borramos la marca para permitir reintento.
    try {
      await (prisma as any).taskNotificationSent.create({
        data: { taskId: p.taskId, ruleKey: p.ruleKey, userId: p.userId }
      });
    } catch {
      skipped++;
      continue;
    }
    try {
      const niceTime = `${String(p.dueAt.getUTCHours()).padStart(2, "0")}:${String(p.dueAt.getUTCMinutes()).padStart(2, "0")}`;
      const niceDate = p.dueAt.toISOString().slice(0, 10);
      const ruleLabel =
        p.ruleKey === "day_7am" ? "hoy" : p.ruleKey === "1h_before" ? "en 1 hora" : "en 10 minutos";
      await sendEmail({
        to: p.email,
        subject: `Tarea ${ruleLabel}: ${p.title}`,
        html: `
          <p>Hola${p.name ? " " + p.name.split(" ")[0] : ""},</p>
          <p>Recordatorio: tienes la tarea <strong>${escapeHtml(p.title)}</strong> programada para
          <strong>${niceDate} a las ${niceTime}</strong>${p.project ? ` (${escapeHtml(p.project)})` : ""}.</p>
          <p style="color:#64748b;font-size:12px;margin-top:24px">
            Recibes este correo porque eres asignado de esta tarea. Puedes desactivar las
            notificaciones desde el modal de la tarea, sección "Notificaciones por email".
          </p>
        `,
        text: `Recordatorio: tienes la tarea "${p.title}" para ${niceDate} a las ${niceTime}${p.project ? ` (${p.project})` : ""}.`
      });
      sent++;
    } catch (e: any) {
      errors.push({ taskId: p.taskId, ruleKey: p.ruleKey, userId: p.userId, msg: String(e?.message ?? e).slice(0, 200) });
      // Revertir la marca para permitir reintento en la próxima pasada.
      await (prisma as any).taskNotificationSent
        .delete({ where: { taskId_ruleKey_userId: { taskId: p.taskId, ruleKey: p.ruleKey, userId: p.userId } } })
        .catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    candidates: plans.length,
    sent,
    skipped, // ya enviadas o duplicadas
    errors
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
