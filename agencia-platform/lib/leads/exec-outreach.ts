/**
 * Secuencia multicanal de contacto a un DIRECTIVO.
 *
 * Cadencia: email (auto, vía Resend) → LinkedIn (recordatorio) → llamada
 * (recordatorio) → email de cierre (auto). El motor avanza un paso por tick
 * respetando `nextAt`. Los pasos de email se envían solos (con pie de baja,
 * por cumplimiento LSSI/RGPD); los de LinkedIn/llamada crean una notificación
 * para que la persona actúe. Se detiene si el lead pasa a cliente/respondido.
 *
 * Se engancha al cron de leads, igual que la difusión y el auto-seguimiento.
 */
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { sendEmail, isEmailEnabled } from "@/lib/integrations/email";

type Channel = "email" | "linkedin" | "call";
/** Plan de cadencia: día relativo + canal. */
const STEPS: Array<{ day: number; channel: Channel }> = [
  { day: 0, channel: "email" },
  { day: 3, channel: "linkedin" },
  { day: 7, channel: "call" },
  { day: 11, channel: "email" }
];

export async function startExecOutreach(opts: {
  workspaceId: string;
  leadId: string;
  email?: string | null;
  directorName?: string | null;
}): Promise<{ id: string }> {
  const row = await prisma.leadExecOutreach.upsert({
    where: { workspaceId_leadId: { workspaceId: opts.workspaceId, leadId: opts.leadId } },
    create: {
      workspaceId: opts.workspaceId,
      leadId: opts.leadId,
      email: opts.email ?? null,
      directorName: opts.directorName ?? null,
      step: 0,
      status: "active",
      nextAt: new Date(),
      log: []
    },
    update: { email: opts.email ?? undefined, directorName: opts.directorName ?? undefined, step: 0, status: "active", nextAt: new Date(), log: [] }
  });
  return { id: row.id };
}

export async function stopExecOutreach(workspaceId: string, leadId: string): Promise<void> {
  await prisma.leadExecOutreach.updateMany({
    where: { workspaceId, leadId, status: "active" },
    data: { status: "stopped" }
  });
}

const EMAIL_SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"]
};

const EMAIL_SYSTEM = `Eres un consultor de marketing local (Negocio Vivo) que escribe a un DIRECTIVO de una
empresa para ofrecerle captación de clientes, reseñas y fidelización. Redacta un EMAIL frío B2B:
- Español de España, trato de usted, profesional y directo. Asunto corto y concreto (sin clickbait).
- Cuerpo de 4-6 líneas: motivo concreto (oportunidad/problema típico de su sector), una frase de
  valor y un cierre con propuesta de llamada de 10 min. Nada de adjuntos ni promesas vacías.
- No inventes datos, cifras ni precios. Devuelve SOLO el JSON {subject, body}.`;

async function writeEmail(opts: { workspaceId: string; company: string; sector?: string | null; director?: string | null; touch: number }): Promise<{ subject: string; body: string }> {
  const ctx = [
    `Empresa: ${opts.company}`,
    opts.sector ? `Sector: ${opts.sector}` : null,
    opts.director ? `Directivo: ${opts.director}` : "Directivo: máximo responsable",
    opts.touch > 1 ? `Es un email de SEGUIMIENTO (toque ${opts.touch}); cambia el enfoque y sé aún más breve.` : null
  ]
    .filter(Boolean)
    .join("\n");
  return completeJson<{ subject: string; body: string }>({
    workspaceId: opts.workspaceId,
    model: "claude-haiku-4-5-20251001",
    system: EMAIL_SYSTEM,
    user: `${ctx}\n\nEscribe el email:`,
    schema: EMAIL_SCHEMA,
    maxTokens: 500
  });
}

function emailHtml(body: string): string {
  const paras = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">${paras}
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
    <p style="font-size:11px;color:#888;margin:0">Si no desea recibir más comunicaciones comerciales, responda <strong>BAJA</strong> a este correo y le retiraremos de inmediato (RGPD/LSSI).</p>
  </div>`;
}

async function notifyAdmins(workspaceId: string, body: string, link: string, tag: string): Promise<void> {
  const admins = await prisma.membership.findMany({ where: { workspaceId, role: "ADMIN" }, select: { userId: true } });
  if (admins.length === 0) return;
  await prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.userId, type: "exec_outreach", body, link })) });
  try {
    const { sendPushToUser } = await import("@/lib/push/web-push");
    await Promise.all(admins.map((a) => sendPushToUser(a.userId, { title: "Secuencia directivo", body, link, tag }).catch(() => {})));
  } catch {}
}

export async function processExecOutreachTick(workspaceId: string): Promise<{ processed: boolean; leadId?: string; channel?: string; error?: string }> {
  const now = new Date();
  const row = await prisma.leadExecOutreach.findFirst({
    where: { workspaceId, status: "active", nextAt: { lte: now } },
    orderBy: { nextAt: "asc" }
  });
  if (!row) return { processed: false };

  const lead = await prisma.lead.findFirst({
    where: { id: row.leadId, workspaceId },
    select: { name: true, category: true, contactStatus: true, phone: true, internationalPhone: true }
  });
  // Si el lead ya avanzó en el funnel O está EXCLUIDO (opt-out / bloqueo), paramos.
  if (!lead || ["client", "responded", "discarded", "excluded"].includes(lead.contactStatus)) {
    await prisma.leadExecOutreach.update({ where: { id: row.id }, data: { status: "stopped" } });
    return { processed: false, error: lead?.contactStatus === "excluded" ? "lead_blocked" : "lead_advanced" };
  }
  // Veto por teléfono: si alguno de sus números está en opt-out, no contactar.
  const { normalizePhone } = await import("./waha");
  const phones = [lead.internationalPhone, lead.phone]
    .map((p) => normalizePhone(p))
    .filter(Boolean) as string[];
  if (phones.length) {
    const veto = await prisma.leadOptout.findFirst({
      where: { workspaceId, phone: { in: phones } },
      select: { id: true }
    });
    if (veto) {
      await prisma.leadExecOutreach.update({ where: { id: row.id }, data: { status: "stopped" } });
      return { processed: false, error: "recipient_opted_out" };
    }
  }

  const stepDef = STEPS[row.step];
  if (!stepDef) {
    await prisma.leadExecOutreach.update({ where: { id: row.id }, data: { status: "done" } });
    return { processed: false, error: "no_step" };
  }

  const link = `/admin/leads?lead=${row.leadId}`;
  const log: any[] = Array.isArray(row.log) ? row.log : [];
  let channelDone = stepDef.channel as string;

  try {
    if (stepDef.channel === "email") {
      const emailTouch = STEPS.slice(0, row.step + 1).filter((s) => s.channel === "email").length;
      if (row.email && isEmailEnabled()) {
        const mail = await writeEmail({ workspaceId, company: lead.name, sector: lead.category, director: row.directorName, touch: emailTouch });
        const out = await sendEmail({ to: row.email, subject: mail.subject, html: emailHtml(mail.body), text: mail.body });
        log.push({ at: now.toISOString(), channel: "email", to: row.email, subject: mail.subject, id: out.id });
      } else {
        // Sin email destino o sin Resend → recordatorio manual.
        channelDone = "email_manual";
        await notifyAdmins(workspaceId, `📨 Envía tú el email a ${row.directorName ?? lead.name}${row.email ? ` (${row.email})` : " (falta email)"}.`, link, `exec-${row.id}-${row.step}`);
        log.push({ at: now.toISOString(), channel: "email_manual", reason: row.email ? "resend_off" : "no_email" });
      }
    } else if (stepDef.channel === "linkedin") {
      await notifyAdmins(workspaceId, `🔗 Hoy toca LinkedIn: contacta a ${row.directorName ?? "el responsable"} de ${lead.name}.`, link, `exec-${row.id}-${row.step}`);
      log.push({ at: now.toISOString(), channel: "linkedin" });
    } else {
      await notifyAdmins(workspaceId, `📞 Hoy toca llamar a ${lead.name}${row.directorName ? ` (${row.directorName})` : ""}.`, link, `exec-${row.id}-${row.step}`);
      log.push({ at: now.toISOString(), channel: "call" });
    }
  } catch (e: any) {
    return { processed: false, error: `step_failed: ${e?.message ?? e}` };
  }

  // Avanza al siguiente paso (o finaliza).
  const next = row.step + 1;
  if (next >= STEPS.length) {
    await prisma.leadExecOutreach.update({ where: { id: row.id }, data: { status: "done", step: next, log } });
  } else {
    const deltaDays = STEPS[next].day - STEPS[row.step].day;
    await prisma.leadExecOutreach.update({
      where: { id: row.id },
      data: { step: next, nextAt: new Date(now.getTime() + Math.max(1, deltaDays) * 86_400_000), log }
    });
  }
  return { processed: true, leadId: row.leadId, channel: channelDone };
}
