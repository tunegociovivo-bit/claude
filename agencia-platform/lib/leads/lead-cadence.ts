import { prisma } from "@/lib/db/prisma";
import { randomUUID } from "node:crypto";
import { LEADS_FROM, retrieveResendSentEmail, sendEmail } from "@/lib/integrations/email";
import { phoneKind } from "./phone-type";
import { normalizePhone } from "./waha";
import { enqueueMessage } from "./send-queue";
import { addSuppression, isLeadSuppressed } from "./suppressions";
import { createUnsubscribeToken, unsubscribeUrl } from "./unsubscribe-token";
import { recordLeadContactEvent } from "./contact-events";
import { buildGmbCadencePlan } from "./gmb-cadence-plan";
import { getGmbMultichannelSettings } from "./gmb-multichannel-readiness";
import { normalizeEmail } from "./email-verification";
import { classifyResendFailure, resendFailureRetryAt } from "./resend-webhook";

export { buildGmbCadencePlan } from "./gmb-cadence-plan";

const DEFAULT_STEPS = [
  {
    order: 0,
    channel: "whatsapp",
    delayHours: 0,
    subject: null,
    condition: { stage: "mobile_day1" },
    templateBody: "Hola, soy del equipo de Negocio Vivo. Al revisar datos públicos de Google hemos visto la posición de {{nombre}} frente a otros negocios de la zona. Si te resulta útil, podemos prepararte sin coste una auditoría comparativa en 24 horas. ¿Quieres que te la enviemos?"
  },
  {
    order: 1,
    channel: "email",
    delayHours: 72,
    subject: "Datos públicos sobre la visibilidad de {{companyName}} en Google",
    condition: { stage: "mobile_day3" },
    templateBody: "Hola,\n\nTe escribimos hace unos días por WhatsApp tras revisar datos públicos de Google sobre {{companyName}} y su posición frente a negocios de la misma zona. Podemos prepararte sin coste una auditoría comparativa con los puntos observados, lista en 24 horas.\n\nSi quieres recibirla, responde a este correo con “AUDITORÍA”.\n\nUn saludo,\nEquipo de Negocio Vivo"
  },
  {
    order: 2,
    channel: "whatsapp",
    delayHours: 168,
    subject: null,
    condition: { stage: "mobile_day8_whatsapp" },
    templateBody: "Hola de nuevo. Cierro por aquí el contacto sobre la visibilidad pública de {{nombre}} en Google. Si quieres que preparemos la auditoría comparativa gratuita en 24 horas, responde AUDITORÍA y te la enviamos. Si no te interesa, dímelo y no volveremos a contactarte."
  },
  {
    order: 3,
    channel: "email",
    delayHours: 168,
    subject: "Último aviso sobre el informe de {{companyName}}",
    condition: { stage: "mobile_day8_email" },
    templateBody: "Hola,\n\nCierro este contacto sobre los datos públicos de visibilidad de {{companyName}} en Google. Si quieres que preparemos la auditoría comparativa gratuita en 24 horas, responde “AUDITORÍA” y te la enviamos.\n\nSi no es relevante para ti, no hace falta que respondas; este es el último mensaje de la secuencia.\n\nUn saludo,\nEquipo de Negocio Vivo"
  },
  {
    order: 4,
    channel: "email",
    delayHours: 0,
    subject: "Datos públicos sobre la visibilidad de {{companyName}} en Google",
    condition: { stage: "email_day1" },
    templateBody: "Hola,\n\nHemos revisado datos públicos de Google sobre {{companyName}} y su posición frente a negocios de la misma zona. Podemos prepararte sin coste una auditoría comparativa con los puntos observados, lista en 24 horas.\n\nSi quieres recibirla, responde a este correo con “AUDITORÍA”.\n\nUn saludo,\nEquipo de Negocio Vivo"
  },
  {
    order: 5,
    channel: "email",
    delayHours: 48,
    subject: "¿Te preparo el informe de {{companyName}}?",
    condition: { stage: "email_day3" },
    templateBody: "Hola,\n\nSolo quería confirmar si te resultaría útil recibir la auditoría comparativa gratuita sobre la visibilidad de {{companyName}} en Google. La preparamos en 24 horas y puedes solicitarla respondiendo “AUDITORÍA”.\n\nSi no te interesa, este será el último correo.\n\nUn saludo,\nEquipo de Negocio Vivo"
  }
] as const;

function render(template: string, companyName: string) {
  return template
    .replace(/{{\s*companyName\s*}}/g, companyName)
    .replace(/{{\s*nombre\s*}}/g, companyName);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function toEmailHtml(text: string, optoutUrl: string) {
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => `<p style="margin:0 0 16px">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
  return `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#172033;max-width:620px">${paragraphs}<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:12px;color:#667085">Negocio Vivo · Información elaborada a partir de datos públicos. <a href="${escapeHtml(optoutUrl)}">No recibir más comunicaciones</a>.</p></div>`;
}

function sender(campaign: { senderName: string | null; senderEmail: string | null }) {
  return campaign.senderEmail
    ? `${campaign.senderName?.trim() || "Negocio Vivo"} <${campaign.senderEmail.trim()}>`
    : LEADS_FROM;
}

async function getOrCreateCampaign(workspaceId: string) {
  const defaultKey = `${workspaceId}:gmb_multichannel`;
  const current = await prisma.prospectingCampaign.findUnique({
    where: { defaultKey },
    include: { steps: true }
  });
  if (current) return current;
  const settings = await getGmbMultichannelSettings(workspaceId);
  try {
    return await prisma.prospectingCampaign.create({
      data: {
        workspaceId,
        name: "GMB · WhatsApp + email autónomo",
        source: "google_places",
        status: "active",
        objective: "audit_request",
        kind: "gmb_multichannel",
        isDefault: true,
        defaultKey,
        complianceMode: "active",
        senderName: settings.senderName,
        senderEmail: settings.senderEmail,
        replyTo: settings.replyTo,
        activeWeekdays: [1, 2, 3, 4, 5],
        startHour: 9,
        endHour: 18,
        settings: { mobileEmailAfterHours: 72, finalAfterHours: 168 },
        steps: { create: DEFAULT_STEPS.map((step) => ({ ...step })) }
      },
      include: { steps: true }
    });
  } catch (error) {
    // Varios enriquecimientos terminan en paralelo. La clave única convierte
    // la carrera de creación en una lectura de la campaña que ya ganó.
    const raced = await prisma.prospectingCampaign.findUnique({ where: { defaultKey }, include: { steps: true } });
    if (raced) return raced;
    throw error;
  }
}

export async function ensureLeadMultichannelCadence(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { search: { select: { source: true } } }
  });
  if (!lead || lead.search?.source !== "places" || lead.contactStatus !== "pending") return { enrolled: false, reason: "not_eligible" };
  const settings = await getGmbMultichannelSettings(lead.workspaceId);
  if (!settings.enabled) return { enrolled: false, reason: "disabled" };

  const mobileCandidate = phoneKind(lead.phone, lead.internationalPhone) === "mobile"
    ? normalizePhone(lead.internationalPhone ?? lead.phone, "34")
    : null;
  // Solo un verificador de buzón puede habilitar envío autónomo. Un MX válido
  // confirma el dominio, pero no que info@/contacto@ exista realmente.
  const emailCandidate = lead.emailVerificationStatus === "deliverable" ? lead.email : null;
  const phone = mobileCandidate && !await isLeadSuppressed({ workspaceId: lead.workspaceId, leadId: lead.id, phone: mobileCandidate }) ? mobileCandidate : null;
  const verifiedEmail = emailCandidate && !await isLeadSuppressed({ workspaceId: lead.workspaceId, leadId: lead.id, email: emailCandidate, phone: mobileCandidate }) ? emailCandidate : null;
  const mobile = !!phone;
  if (!phone && !verifiedEmail) return { enrolled: false, reason: "no_verified_channel" };

  const campaign = await getOrCreateCampaign(lead.workspaceId);
  const anchor = nextBusinessSlot(new Date());
  const plan = buildGmbCadencePlan(mobile, anchor);
  const planByStage = new Map(plan.map((item) => [item.stage, item]));
  const stageNames = plan.map((item) => item.stage);
  const selectedSteps = campaign.steps.filter((step) => stageNames.includes(String((step.condition as any)?.stage)));
  try {
    const enrolled = await prisma.$transaction(async (tx) => {
      const existing = await tx.prospectingProspect.findUnique({
        where: { campaignId_leadId: { campaignId: campaign.id, leadId: lead.id } },
        select: { id: true }
      });
      if (existing) return { created: false, prospectId: existing.id };

      const prospect = await tx.prospectingProspect.create({
        data: {
          workspaceId: lead.workspaceId,
          campaignId: campaign.id,
          leadId: lead.id,
          companyName: lead.name,
          email: verifiedEmail,
          phone,
          website: lead.website,
          companyDomain: (() => { try { return lead.website ? new URL(/^https?:/i.test(lead.website) ? lead.website : `https://${lead.website}`).hostname.replace(/^www\./, "") : null; } catch { return null; } })(),
          status: "active",
          cadenceAnchorAt: anchor,
          metadata: { branch: mobile ? "mobile" : "email_only", searchId: lead.searchId, compliance: settings.compliance }
        }
      });
      const createdActivities = await tx.prospectingActivity.createMany({
        data: selectedSteps.map((step) => ({
          recipientKey: (() => {
            const stage = String((step.condition as any)?.stage);
            const recipient = step.channel === "email" ? verifiedEmail?.toLowerCase() : phone;
            return recipient ? `gmb:${campaign.id}:${step.channel}:${recipient}:${stage}` : null;
          })(),
          workspaceId: lead.workspaceId,
          campaignId: campaign.id,
          prospectId: prospect.id,
          stepId: step.id,
          idempotencyKey: `gmb:${campaign.id}:${lead.id}:${String((step.condition as any)?.stage)}`,
          channel: step.channel,
          action: "send",
          status: "queued",
          scheduledAt: planByStage.get(String((step.condition as any)?.stage))?.scheduledAt ?? anchor,
          payload: { stage: String((step.condition as any)?.stage), compliance: settings.compliance, providerAttempt: 0 }
        })),
        skipDuplicates: true
      });
      if (!createdActivities.count) {
        await tx.prospectingProspect.update({
          where: { id: prospect.id },
          data: { status: "completed", stopReason: "Destinatario ya incluido en esta cadencia" }
        });
      }
      return { created: true, prospectId: prospect.id };
    });
    return { enrolled: enrolled.created, reason: enrolled.created ? undefined : "already_enrolled", prospectId: enrolled.prospectId };
  } catch (error) {
    // La restricción única evita dos altas simultáneas del mismo lead. Si otra
    // transacción ganó, su prospecto ya contiene todas las actividades.
    const raced = await prisma.prospectingProspect.findUnique({
      where: { campaignId_leadId: { campaignId: campaign.id, leadId: lead.id } },
      select: { id: true }
    });
    if (raced) return { enrolled: false, reason: "already_enrolled", prospectId: raced.id };
    throw error;
  }
}

function canRunAt(campaign: { activeWeekdays: unknown; startHour: number; endHour: number }, now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((part) => part.type === "weekday")?.value ?? "");
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? -1);
  const days = Array.isArray(campaign.activeWeekdays) ? campaign.activeWeekdays.filter((day): day is number => typeof day === "number") : [1, 2, 3, 4, 5];
  return days.includes(weekday) && hour >= campaign.startHour && hour < campaign.endHour;
}

function nextBusinessSlot(from: Date): Date {
  const schedule = { activeWeekdays: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 };
  if (canRunAt(schedule, from)) return from;
  const candidate = new Date(from);
  candidate.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 8; i++) {
    candidate.setUTCHours(candidate.getUTCHours() + 1);
    if (canRunAt(schedule, candidate)) return candidate;
  }
  return new Date(from.getTime() + 24 * 60 * 60_000);
}

function activityStage(activity: { payload: unknown }) {
  return String((activity.payload as any)?.stage ?? "");
}

async function dependencyDueAt(opts: {
  prospectId: string;
  stage: string;
  cadenceAnchorAt: Date | null;
  now: Date;
}): Promise<Date | "skip" | null> {
  if (opts.stage === "mobile_day1" || opts.stage === "email_day1") return null;
  const siblings = await prisma.prospectingActivity.findMany({
    where: { prospectId: opts.prospectId },
    select: { id: true, status: true, scheduledAt: true, executedAt: true, payload: true }
  });
  const byStage = new Map(siblings.map((activity) => [activityStage(activity), activity]));
  const anchor = opts.cadenceAnchorAt ?? opts.now;

  if (opts.stage === "email_day3") {
    const first = byStage.get("email_day1");
    if (first && ["failed", "skipped"].includes(first.status)) return "skip";
    if (!first || first.status !== "sent" || !first.executedAt) return new Date(opts.now.getTime() + 30 * 60_000);
    return new Date(first.executedAt.getTime() + 48 * 60 * 60_000);
  }

  const first = byStage.get("mobile_day1");
  if (!first) return new Date(opts.now.getTime() + 30 * 60_000);
  const firstMessage = await prisma.leadMessage.findUnique({
    where: { prospectingActivityId: first.id },
    select: { status: true, sentAt: true }
  });
  let firstContactAt: Date | null = firstMessage?.sentAt ?? null;
  if (!firstContactAt && firstMessage && ["failed", "canceled", "blocked_link"].includes(firstMessage.status)) {
    firstContactAt = anchor;
  }
  if (!firstContactAt && ["failed", "skipped"].includes(first.status)) firstContactAt = anchor;
  if (!firstContactAt) return new Date(opts.now.getTime() + 30 * 60_000);
  if (opts.stage === "mobile_day3") return new Date(firstContactAt.getTime() + 72 * 60 * 60_000);

  if (opts.stage.startsWith("mobile_day8")) {
    const middle = byStage.get("mobile_day3");
    if (middle && ["queued", "processing", "awaiting_review"].includes(middle.status)) {
      return new Date(opts.now.getTime() + 30 * 60_000);
    }
    return new Date(firstContactAt.getTime() + 168 * 60 * 60_000);
  }
  return null;
}

export async function finishProspectIfDone(prospectId: string) {
  const remaining = await prisma.prospectingActivity.count({ where: { prospectId, status: { in: ["queued", "processing", "awaiting_review"] } } });
  if (!remaining) {
    await prisma.prospectingProspect.updateMany({
      where: { id: prospectId, status: "active" },
      data: { status: "completed", nextActionAt: null }
    });
  }
}

async function revalidateEmailImmediatelyBeforeSend(opts: { workspaceId: string; activityId: string; stage: string }) {
  const activity = await prisma.prospectingActivity.findFirst({
    where: { id: opts.activityId, workspaceId: opts.workspaceId },
    include: { prospect: true, campaign: true }
  });
  const lead = activity?.prospect?.leadId
    ? await prisma.lead.findFirst({ where: { id: activity.prospect.leadId, workspaceId: opts.workspaceId } })
    : null;
  const settings = await getGmbMultichannelSettings(opts.workspaceId);
  const phone = lead ? normalizePhone(lead.internationalPhone ?? lead.phone, "34") : null;
  const suppressed = lead ? await isLeadSuppressed({ workspaceId: opts.workspaceId, leadId: lead.id, email: lead.email, phone }) : true;
  const stopped = !settings.enabled || !activity || activity.status !== "processing" ||
    activity.campaign.status !== "active" || activity.campaign.complianceMode !== "active" ||
    !activity.prospect || activity.prospect.status !== "active" || !!activity.prospect.humanRepliedAt || !!activity.prospect.suppressedAt ||
    !lead || !["pending", "contacted"].includes(lead.contactStatus) || suppressed ||
    !lead.email || lead.emailVerificationStatus !== "deliverable" ||
    ((opts.stage === "email_day3" || opts.stage.startsWith("mobile_day8")) && !!activity.prospect.lastEmailOpenedAt);
  if (stopped || !activity || !lead) return null;

  // Reserva condicional: si un webhook cambió prospecto/campaña/actividad entre
  // la lectura y este punto, no se llega a tocar el proveedor externo.
  const reserved = await prisma.prospectingActivity.updateMany({
    where: {
      id: activity.id,
      status: "processing",
      prospect: { is: { status: "active", humanRepliedAt: null, suppressedAt: null } },
      campaign: { is: { status: "active", complianceMode: "active" } }
    },
    data: { leaseUntil: new Date(Date.now() + 10 * 60_000) }
  });
  return reserved.count ? { activity, lead } : null;
}

export async function processGmbCadenceTick(workspaceId: string, batchSize = 6) {
  const settings = await getGmbMultichannelSettings(workspaceId);
  if (!settings.enabled) return { enabled: false, processed: 0, sent: 0, skipped: 0, failed: 0 };
  const now = new Date();
  const campaign = await prisma.prospectingCampaign.findFirst({
    where: { workspaceId, kind: "gmb_multichannel", isDefault: true, status: "active", complianceMode: "active" },
    include: { steps: true }
  });
  if (!campaign || !canRunAt(campaign, now)) return { enabled: true, processed: 0, sent: 0, skipped: 0, failed: 0 };
  const leaseOwner = randomUUID();
  const campaignClaim = await prisma.prospectingCampaign.updateMany({
    where: { id: campaign.id, OR: [{ engineLeaseUntil: null }, { engineLeaseUntil: { lt: now } }] },
    data: { engineLeaseOwner: leaseOwner, engineLeaseUntil: new Date(now.getTime() + 15 * 60_000) }
  });
  if (!campaignClaim.count) return { enabled: true, processed: 0, sent: 0, skipped: 0, failed: 0 };
  try {
  const hourlyLimit = Math.max(1, Math.min(Number((campaign.settings as any)?.emailHourlyLimit ?? 6), 30));
  const [emailsLast24h, emailsLastHour] = await Promise.all([
    prisma.prospectingActivity.count({
      where: { campaignId: campaign.id, channel: "email", status: "sent", executedAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } }
    }),
    prisma.prospectingActivity.count({
      where: { campaignId: campaign.id, channel: "email", status: "sent", executedAt: { gte: new Date(now.getTime() - 60 * 60_000) } }
    })
  ]);
  let dailyEmailRemaining = Math.max(0, campaign.dailyLimit - emailsLast24h);
  let hourlyEmailRemaining = Math.max(0, hourlyLimit - emailsLastHour);

  const due = await prisma.prospectingActivity.findMany({
    where: {
      campaignId: campaign.id,
      OR: [
        { status: "queued", scheduledAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        { status: "processing", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }
      ]
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(batchSize, 20)),
    include: { prospect: true }
  });
  const stepById = new Map(campaign.steps.map((step) => [step.id, step]));
  let sent = 0, skipped = 0, failed = 0;

  for (const activity of due) {
    const renewed = await prisma.prospectingCampaign.updateMany({
      where: { id: campaign.id, engineLeaseOwner: leaseOwner },
      data: { engineLeaseUntil: new Date(Date.now() + 15 * 60_000) }
    });
    if (!renewed.count) break;
    const claimed = await prisma.prospectingActivity.updateMany({
      where: {
        id: activity.id,
        OR: [
          { status: "queued", scheduledAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
          { status: "processing", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }
        ]
      },
      data: { status: "processing", leaseUntil: new Date(Date.now() + 10 * 60_000), attempts: { increment: 1 }, error: null }
    });
    if (!claimed.count) continue;

    // Releer tras el claim evita decidir con el snapshot anterior: una
    // respuesta o baja concurrente puede haber detenido el prospecto.
    const currentActivity = await prisma.prospectingActivity.findUnique({
      where: { id: activity.id },
      include: { prospect: true }
    });
    const prospect = currentActivity?.prospect;
    if (!currentActivity || currentActivity.status !== "processing") continue;
    if (!prospect?.leadId) {
      await prisma.prospectingActivity.update({
        where: { id: currentActivity.id },
        data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Actividad sin lead asociado" }
      });
      skipped++;
      continue;
    }
    const step = currentActivity.stepId ? stepById.get(currentActivity.stepId) : null;
    const stage = String((step?.condition as any)?.stage ?? (currentActivity.payload as any)?.stage ?? "");
    if (currentActivity.channel === "email" && (!dailyEmailRemaining || !hourlyEmailRemaining)) {
      await prisma.prospectingActivity.update({
        where: { id: currentActivity.id },
        data: {
          status: "queued",
          scheduledAt: new Date(now.getTime() + 60 * 60_000),
          leaseUntil: null,
          attempts: { decrement: 1 },
          error: "Aplazado por límite horario/diario de email"
        }
      });
      continue;
    }
    const dependencyAt = await dependencyDueAt({
      prospectId: prospect.id,
      stage,
      cadenceAnchorAt: prospect.cadenceAnchorAt,
      now
    });
    if (dependencyAt === "skip") {
      await prisma.prospectingActivity.update({
        where: { id: currentActivity.id },
        data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Omitido: el paso anterior falló" }
      });
      await finishProspectIfDone(prospect.id);
      skipped++;
      continue;
    }
    if (dependencyAt && dependencyAt.getTime() > now.getTime()) {
      await prisma.prospectingActivity.update({
        where: { id: currentActivity.id },
        data: {
          status: "queued",
          scheduledAt: dependencyAt,
          leaseUntil: null,
          attempts: { decrement: 1 },
          error: "A la espera del paso anterior de la cadencia"
        }
      });
      continue;
    }
    const lead = await prisma.lead.findFirst({ where: { id: prospect.leadId, workspaceId } });
    const phone = lead ? normalizePhone(lead.internationalPhone ?? lead.phone, "34") : null;
    const channelSuppressed = await isLeadSuppressed({
      workspaceId,
      leadId: lead?.id,
      phone,
      ...(activity.channel === "email" ? { email: lead?.email } : {})
    });
    const shouldSkip = !lead || !["pending", "contacted"].includes(lead.contactStatus) || prospect.status !== "active" || !!prospect.humanRepliedAt || !!prospect.suppressedAt ||
      channelSuppressed ||
      ((stage === "email_day3" || stage.startsWith("mobile_day8")) && !!prospect.lastEmailOpenedAt);
    if (shouldSkip) {
      await prisma.prospectingActivity.update({ where: { id: activity.id }, data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Cadencia detenida por respuesta, apertura o supresión" } });
      await finishProspectIfDone(prospect.id);
      skipped++;
      continue;
    }

    try {
      if (!step) throw new Error("Paso de cadencia no encontrado");
      if (activity.channel === "email") {
        if (!lead.email || lead.emailVerificationStatus !== "deliverable") {
          await prisma.prospectingActivity.update({ where: { id: activity.id }, data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Lead sin buzón verificado como entregable" } });
          await finishProspectIfDone(prospect.id);
          skipped++;
          continue;
        }
        const finalGate = await revalidateEmailImmediatelyBeforeSend({ workspaceId, activityId: activity.id, stage });
        const sendEmailAddress = finalGate?.lead.email;
        if (!finalGate || !sendEmailAddress) {
          await prisma.prospectingActivity.updateMany({
            where: { id: activity.id, status: "processing" },
            data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Cancelado en la barrera final: respuesta, baja, apertura o configuración" }
          });
          await finishProspectIfDone(prospect.id);
          skipped++;
          continue;
        }
        const sendLead = finalGate.lead;
        const activityPayload = ((activity.payload as any) ?? {}) as Record<string, any>;
        const providerAttempt = Math.max(0, Number(activityPayload.providerAttempt ?? 0));
        let emailSnapshot = activityPayload.emailSendSnapshot as Record<string, any> | undefined;
        if (!emailSnapshot || Number(emailSnapshot.providerAttempt) !== providerAttempt) {
          const token = createUnsubscribeToken({ workspaceId, leadId: sendLead.id, email: sendEmailAddress });
          const optoutUrl = unsubscribeUrl(token);
          const renderedBody = render(step.templateBody ?? "", sendLead.name);
          emailSnapshot = {
            providerAttempt,
            to: sendEmailAddress,
            subject: render(step.subject ?? "Información sobre tu visibilidad en Google", sendLead.name),
            text: renderedBody + `\n\nBaja: ${optoutUrl}`,
            html: toEmailHtml(renderedBody, optoutUrl),
            from: sender(campaign),
            replyTo: campaign.replyTo ?? null,
            optoutUrl
          };
          const persisted = await prisma.prospectingActivity.updateMany({
            where: { id: activity.id, status: "processing" },
            data: { payload: { ...activityPayload, providerAttempt, emailSendSnapshot: emailSnapshot } }
          });
          if (!persisted.count) {
            skipped++;
            continue;
          }
        }
        const text = String(emailSnapshot.text);
        const subject = String(emailSnapshot.subject);
        const optoutUrl = String(emailSnapshot.optoutUrl);
        const lastMomentGate = await revalidateEmailImmediatelyBeforeSend({ workspaceId, activityId: activity.id, stage });
        if (!lastMomentGate || normalizeEmail(lastMomentGate.lead.email) !== normalizeEmail(String(emailSnapshot.to))) {
          await prisma.prospectingActivity.updateMany({
            where: { id: activity.id, status: "processing" },
            data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Cancelado justo antes de Resend: cambió el destinatario o la elegibilidad" }
          });
          await finishProspectIfDone(prospect.id);
          skipped++;
          continue;
        }
        const normalizedRecipient = normalizeEmail(String(emailSnapshot.to));
        if (!normalizedRecipient) {
          await prisma.prospectingActivity.updateMany({
            where: { id: activity.id, status: "processing" },
            data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Cancelado: destinatario de email inválido" }
          });
          await finishProspectIfDone(prospect.id);
          skipped++;
          continue;
        }
        const recipientKey = `gmb:${campaign.id}:email:${normalizedRecipient}:${stage}`;
        let recipientClaimed = false;
        try {
          const claim = await prisma.prospectingActivity.updateMany({
            where: { id: activity.id, status: "processing" },
            data: {
              recipientKey,
              leaseUntil: new Date(Date.now() + 10 * 60_000),
              payload: { ...activityPayload, providerAttempt, emailSendSnapshot: emailSnapshot }
            }
          });
          recipientClaimed = claim.count === 1;
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code)
            : null;
          if (code !== "P2002") throw error;
        }
        if (!recipientClaimed) {
          await prisma.prospectingActivity.updateMany({
            where: { id: activity.id, status: "processing" },
            data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Omitido: este destinatario ya recibió la misma etapa" }
          });
          await finishProspectIfDone(prospect.id);
          skipped++;
          continue;
        }
        const result = await sendEmail({
          workspaceId,
          to: String(emailSnapshot.to),
          subject,
          text,
          html: String(emailSnapshot.html),
          from: String(emailSnapshot.from),
          replyTo: emailSnapshot.replyTo ? String(emailSnapshot.replyTo) : undefined,
          idempotencyKey: `${activity.idempotencyKey ?? `gmb-email-${activity.id}`}:provider:${providerAttempt}`,
          headers: { "List-Unsubscribe": `<${optoutUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          tags: [
            { name: "module", value: "nv_leads_pro" },
            { name: "stage", value: stage || "gmb" },
            { name: "activity", value: activity.id },
            { name: "provider_attempt", value: String(providerAttempt) }
          ],
          globalConfigOnly: true
        });
        // El mapeo y el mensaje quedan en una sola transacción. La condición
        // por providerAttempt impide que un caller antiguo reviva un intento
        // que un webhook ya reencoló o dio por fallido.
        const mapped = await prisma.$transaction(async (tx) => {
          const claim = await tx.prospectingActivity.updateMany({
            where: {
              id: activity.id,
              status: "processing",
              payload: { path: ["providerAttempt"], equals: providerAttempt }
            },
            data: { externalId: result.id }
          });
          if (!claim.count) return false;
          await tx.prospectingMessage.create({
            data: { workspaceId, campaignId: campaign.id, prospectId: prospect.id, channel: "email", direction: "out", body: text, status: "sent", externalId: result.id, metadata: { activityId: activity.id, stage, subject, rfcMessageId: null, providerAttempt } }
          });
          return true;
        });
        if (!mapped) {
          skipped++;
          continue;
        }
        await recordLeadContactEvent({ workspaceId, leadId: lead.id, prospectId: prospect.id, channel: "email", type: "sent", provider: "resend", providerEventId: `sent:${result.id}`, externalMessageId: result.id, metadata: { activityId: activity.id, stage } });
        const sentDetails = await retrieveResendSentEmail(workspaceId, result.id, { globalConfigOnly: true }).catch(() => null);
        const rfcMessageId = String(sentDetails?.message_id ?? "") || null;
        if (rfcMessageId) {
          await prisma.prospectingMessage.updateMany({
            where: { workspaceId, channel: "email", externalId: result.id },
            data: { rfcMessageId: rfcMessageId.replace(/^<|>$/g, "").toLowerCase(), metadata: { activityId: activity.id, stage, subject, rfcMessageId } }
          });
        }
        // No pises un `skipped` escrito por una baja/respuesta mientras Resend
        // estaba procesando la petición.
        await prisma.prospectingActivity.updateMany({
          where: {
            id: activity.id,
            status: "processing",
            payload: { path: ["providerAttempt"], equals: providerAttempt }
          },
          data: { status: "sent", externalId: result.id, executedAt: now, leaseUntil: null }
        });
        dailyEmailRemaining--;
        hourlyEmailRemaining--;
      } else {
        if (phoneKind(lead.phone, lead.internationalPhone) !== "mobile") {
          await prisma.prospectingActivity.update({ where: { id: activity.id }, data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Lead sin móvil" } });
          await finishProspectIfDone(prospect.id);
          skipped++;
          continue;
        }
        const queued = await enqueueMessage({ workspaceId, leadId: lead.id, body: step.templateBody ?? "", skipDuplicateCheck: true, idempotencyKey: activity.idempotencyKey ?? `gmb-whatsapp-${activity.id}`, prospectingActivityId: activity.id });
        await recordLeadContactEvent({ workspaceId, leadId: lead.id, prospectId: prospect.id, channel: "whatsapp", type: "queued", provider: "nv_queue", providerEventId: `queued:${queued.messageId}`, externalMessageId: queued.messageId, metadata: { activityId: activity.id, stage, scheduledAt: queued.scheduledAt.toISOString() } });
        await prisma.prospectingActivity.update({ where: { id: activity.id }, data: { status: "sent", externalId: queued.messageId, executedAt: now, leaseUntil: null } });
      }
      await prisma.prospectingProspect.updateMany({ where: { id: prospect.id, status: "active" }, data: { lastContactedAt: now } });
      await prisma.lead.updateMany({ where: { id: lead.id, contactStatus: "pending" }, data: { contactStatus: "contacted" } });
      await finishProspectIfDone(prospect.id);
      sent++;
    } catch (error) {
      const errorMessage = String((error as any)?.message ?? error).slice(0, 1000);
      const resendStatus = Number((error as any)?.resendStatus ?? 0) || null;
      const failureKind = currentActivity.channel === "email"
        ? classifyResendFailure(errorMessage, resendStatus)
        : "transient";
      const syncAttempt = Math.max(0, Number((currentActivity.payload as any)?.providerAttempt ?? 0));

      if (failureKind === "invalid_recipient" && lead.email) {
        await addSuppression({ workspaceId, leadId: lead.id, kind: "email", value: lead.email, reason: `Destinatario inválido en Resend: ${errorMessage}`, source: "resend_sync_failed" });
        await prisma.lead.updateMany({
          where: { id: lead.id, workspaceId, email: lead.email },
          data: { emailVerificationStatus: "invalid" }
        });
        await prisma.prospectingActivity.updateMany({
          where: { id: activity.id, workspaceId, status: "processing" },
          data: { status: "failed", executedAt: now, leaseUntil: null, error: `Destinatario inválido: ${errorMessage}` }
        });
        await prisma.prospectingActivity.updateMany({
          where: { prospectId: prospect.id, workspaceId, channel: "email", id: { not: activity.id }, status: { in: ["queued", "processing"] } },
          data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Email bloqueado tras destinatario inválido" }
        });
        await recordLeadContactEvent({ workspaceId, leadId: lead.id, prospectId: prospect.id, channel: "email", type: "failed", provider: "resend", providerEventId: `sync-failed:${activity.id}:${syncAttempt}`, metadata: { stage, reason: errorMessage, kind: failureKind } });
        await finishProspectIfDone(prospect.id);
        failed++;
        continue;
      }

      if (failureKind === "quota") {
        await prisma.prospectingActivity.updateMany({
          where: { id: activity.id, workspaceId, status: "processing" },
          data: {
            status: "queued",
            scheduledAt: resendFailureRetryAt(errorMessage, now),
            executedAt: null,
            leaseUntil: null,
            attempts: { decrement: 1 },
            error: `Aplazado por cuota de Resend: ${errorMessage}`,
            payload: { ...((currentActivity.payload as any) ?? {}), providerAttempt: syncAttempt + 1 }
          }
        });
        failed++;
        continue;
      }

      if (failureKind === "configuration") {
        await prisma.prospectingCampaign.updateMany({
          where: { id: campaign.id, workspaceId },
          data: { status: "paused", complianceMode: "review" }
        });
        await prisma.prospectingActivity.updateMany({
          where: { id: activity.id, workspaceId, status: "processing" },
          data: {
            status: "queued",
            scheduledAt: new Date(now.getTime() + 60 * 60_000),
            executedAt: null,
            leaseUntil: null,
            attempts: { decrement: 1 },
            error: `Campaña pausada por configuración de Resend: ${errorMessage}`,
            payload: { ...((currentActivity.payload as any) ?? {}), providerAttempt: syncAttempt + 1 }
          }
        });
        failed++;
        continue;
      }

      const attempts = currentActivity.attempts;
      const terminal = attempts >= 3;
      await prisma.prospectingActivity.update({
        where: { id: activity.id },
        data: {
          status: terminal ? "failed" : "queued",
          scheduledAt: terminal ? activity.scheduledAt : new Date(Date.now() + (attempts === 1 ? 5 : 30) * 60_000),
          executedAt: terminal ? now : null,
          leaseUntil: null,
          error: errorMessage
        }
      });
      if (terminal) await finishProspectIfDone(prospect.id);
      failed++;
    }
  }
  return { enabled: true, processed: due.length, sent, skipped, failed };
  } finally {
    await prisma.prospectingCampaign.updateMany({
      where: { id: campaign.id, engineLeaseOwner: leaseOwner },
      data: { engineLeaseOwner: null, engineLeaseUntil: null }
    });
  }
}

export async function markLeadHumanReply(opts: { workspaceId: string; leadId: string; channel: "email" | "whatsapp"; body?: string }) {
  const now = new Date();
  const prospects = await prisma.prospectingProspect.findMany({ where: { workspaceId: opts.workspaceId, leadId: opts.leadId }, select: { id: true } });
  const ids = prospects.map((prospect) => prospect.id);
  if (!ids.length) return { stopped: 0 };
  const activityIds = (await prisma.prospectingActivity.findMany({
    where: { prospectId: { in: ids } },
    select: { id: true }
  })).map((activity) => activity.id);
  const stopped = await prisma.prospectingProspect.updateMany({
    where: { id: { in: ids }, status: { not: "excluded" } },
    data: { status: "replied", repliedAt: now, humanRepliedAt: now, nextActionAt: null, stopReason: `Respuesta humana por ${opts.channel}` }
  });
  await prisma.prospectingActivity.updateMany({
    where: { prospectId: { in: ids }, status: { in: ["queued", "processing", "awaiting_review"] } },
    data: { status: "skipped", executedAt: now, leaseUntil: null, error: "Cadencia detenida: respuesta humana" }
  });
  if (activityIds.length) {
    await prisma.leadMessage.updateMany({
      where: { workspaceId: opts.workspaceId, prospectingActivityId: { in: activityIds }, status: "queued" },
      data: { status: "canceled", lastError: "Cancelado: respuesta humana" }
    });
  }
  await prisma.lead.updateMany({ where: { id: opts.leadId, workspaceId: opts.workspaceId }, data: { contactStatus: "responded" } });
  await recordLeadContactEvent({ workspaceId: opts.workspaceId, leadId: opts.leadId, prospectId: ids[0], channel: opts.channel, type: "human_reply", metadata: { body: opts.body?.slice(0, 1000) } });
  return { stopped: stopped.count };
}

export async function markLeadEmailOpened(opts: { workspaceId: string; leadId: string; prospectId?: string | null; externalMessageId?: string | null; providerEventId: string; occurredAt?: Date }) {
  const now = opts.occurredAt ?? new Date();
  await prisma.prospectingProspect.updateMany({
    where: { workspaceId: opts.workspaceId, leadId: opts.leadId, ...(opts.prospectId ? { id: opts.prospectId } : {}) },
    data: { lastEmailOpenedAt: now }
  });
  const day8Activities = opts.prospectId ? (await prisma.prospectingActivity.findMany({
    where: { prospectId: opts.prospectId, channel: "whatsapp" },
    select: { id: true, payload: true }
  })).filter((activity) => activityStage(activity) === "mobile_day8_whatsapp") : [];
  if (day8Activities.length) {
    await prisma.leadMessage.updateMany({
      where: { workspaceId: opts.workspaceId, prospectingActivityId: { in: day8Activities.map((activity) => activity.id) }, status: "queued" },
      data: { status: "canceled", lastError: "Cancelado: el email ya fue abierto" }
    });
  }
  await recordLeadContactEvent({ workspaceId: opts.workspaceId, leadId: opts.leadId, prospectId: opts.prospectId, channel: "email", type: "opened", provider: "resend", providerEventId: opts.providerEventId, externalMessageId: opts.externalMessageId, occurredAt: now });
}
