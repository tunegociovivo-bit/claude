import { prisma } from "@/lib/db/prisma";
import { LEADS_FROM, sendEmail } from "@/lib/integrations/email";

type Tokens = Record<string, string | null | undefined>;

export function renderProspectingTemplate(template: string, values: Tokens): string {
  return template.replace(/{{\s*(firstName|lastName|companyName|jobTitle|email|phone|website)\s*}}/g, (_, key: string) => values[key] || "");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function madridParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", weekday: "short", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value || "");
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  return { weekday, hour };
}

function canRunNow(campaign: { activeWeekdays: unknown; startHour: number; endHour: number }, now: Date) {
  const { weekday, hour } = madridParts(now);
  const days = Array.isArray(campaign.activeWeekdays) ? campaign.activeWeekdays.filter((d): d is number => typeof d === "number") : [1, 2, 3, 4, 5];
  return days.includes(weekday) && hour >= campaign.startHour && hour < campaign.endHour;
}

function nextDate(hours: number, now = new Date()) {
  return new Date(now.getTime() + Math.max(0, hours) * 60 * 60 * 1000);
}

async function advanceProspect(prospectId: string, campaignId: string, nextStep: number, delayHours: number, completed: boolean, now: Date) {
  await prisma.prospectingProspect.updateMany({
    where: { id: prospectId, campaignId, status: "processing" },
    data: completed
      ? { status: "completed", currentStep: nextStep, nextActionAt: null, lastContactedAt: now }
      : { status: "active", currentStep: nextStep, nextActionAt: nextDate(delayHours, now), lastContactedAt: now }
  });
}

export async function completeProspectingActivity(workspaceId: string, activityId: string, action: "complete" | "replied" = "complete") {
  const activity = await prisma.prospectingActivity.findFirst({
    where: { id: activityId, workspaceId, status: "awaiting_review" },
    include: { prospect: true, campaign: { include: { steps: { orderBy: { order: "asc" } } } } }
  });
  if (!activity?.prospect) return null;
  const nextStep = activity.prospect.currentStep + 1;
  const following = activity.campaign.steps[nextStep];
  const now = new Date();
  if (action === "replied") {
    await prisma.$transaction([
      prisma.prospectingActivity.update({ where: { id: activity.id }, data: { status: "completed", executedAt: now, detail: `${activity.detail || ""}\n\nRespuesta registrada` } }),
      prisma.prospectingProspect.update({ where: { id: activity.prospect.id }, data: { status: "replied", repliedAt: now, nextActionAt: null, stopReason: "Respuesta registrada por un administrador" } })
    ]);
    return activity;
  }
  await prisma.$transaction([
    prisma.prospectingActivity.update({ where: { id: activity.id }, data: { status: "completed", executedAt: now } }),
    prisma.prospectingProspect.update({
      where: { id: activity.prospect.id },
      data: following
        ? { status: "active", currentStep: nextStep, nextActionAt: nextDate(following.delayHours, now), lastContactedAt: now }
        : { status: "completed", currentStep: nextStep, nextActionAt: null, lastContactedAt: now }
    })
  ]);
  return activity;
}

export async function markProspectingProspectReplied(workspaceId: string, prospectId: string) {
  const now = new Date();
  const updated = await prisma.prospectingProspect.updateMany({
    where: { id: prospectId, workspaceId, status: { notIn: ["replied", "excluded"] } },
    data: { status: "replied", repliedAt: now, nextActionAt: null, stopReason: "Respuesta registrada por un administrador" }
  });
  if (!updated.count) return null;
  await prisma.prospectingActivity.updateMany({
    where: { prospectId, workspaceId, status: { in: ["queued", "awaiting_review"] } },
    data: { status: "skipped", executedAt: now, error: "Cadencia detenida: el prospecto respondió" }
  });
  return { id: prospectId };
}

export async function runProspectingEngine(now = new Date(), workspaceId?: string) {
  const campaigns = await prisma.prospectingCampaign.findMany({
    where: { status: "active", ...(workspaceId ? { workspaceId } : {}) }, include: { steps: { orderBy: { order: "asc" } } }
  });
  let processed = 0, sent = 0, awaitingReview = 0, skipped = 0, failed = 0;

  for (const campaign of campaigns) {
    if (!canRunNow(campaign, now) || !campaign.steps.length) continue;
    let leaseUntil = new Date(now.getTime() + 30 * 60 * 1000);
    const lease = await prisma.prospectingCampaign.updateMany({
      where: { id: campaign.id, status: "active", OR: [{ engineLeaseUntil: null }, { engineLeaseUntil: { lt: now } }] },
      data: { engineLeaseUntil: leaseUntil }
    });
    if (!lease.count) continue;
    await prisma.prospectingProspect.updateMany({
      where: { campaignId: campaign.id, status: "processing", updatedAt: { lt: new Date(now.getTime() - 15 * 60 * 1000) } },
      data: { status: "active", nextActionAt: now }
    });
    const startOfDay = new Date(now); startOfDay.setUTCHours(0, 0, 0, 0);
    const usedToday = await prisma.prospectingActivity.count({
      where: { campaignId: campaign.id, createdAt: { gte: startOfDay }, status: { in: ["sent", "completed", "awaiting_review"] } }
    });
    const remaining = Math.max(0, Math.min(campaign.dailyLimit - usedToday, 10, 100 - processed));
    if (!remaining) {
      await prisma.prospectingCampaign.updateMany({ where: { id: campaign.id, engineLeaseUntil: leaseUntil }, data: { engineLeaseUntil: null } });
      continue;
    }
    const prospects = await prisma.prospectingProspect.findMany({
      where: { campaignId: campaign.id, status: "active", nextActionAt: { lte: now } }, orderBy: { nextActionAt: "asc" }, take: remaining
    });

    for (const prospect of prospects) {
      const renewedUntil = new Date(Date.now() + 30 * 60 * 1000);
      const stillActive = await prisma.prospectingCampaign.updateMany({
        where: { id: campaign.id, status: "active", engineLeaseUntil: leaseUntil },
        data: { engineLeaseUntil: renewedUntil }
      });
      if (!stillActive.count) break;
      leaseUntil = renewedUntil;
      const claimed = await prisma.prospectingProspect.updateMany({
        where: { id: prospect.id, status: "active", nextActionAt: prospect.nextActionAt }, data: { status: "processing", nextActionAt: null }
      });
      if (!claimed.count) continue;
      processed++;
      const step = campaign.steps[prospect.currentStep];
      if (!step) {
        await prisma.prospectingProspect.update({ where: { id: prospect.id }, data: { status: "completed" } });
        continue;
      }
      const tokens: Tokens = {
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        companyName: prospect.companyName,
        jobTitle: prospect.jobTitle,
        email: prospect.email,
        phone: prospect.phone,
        website: prospect.website
      };
      const body = renderProspectingTemplate(step.templateBody || "", tokens);
      const idempotencyKey = `prospecting:${campaign.id}:${prospect.id}:${step.id}`;
      const nextStep = prospect.currentStep + 1;
      const following = campaign.steps[nextStep];
      const completed = !following;

      try {
        const needsManual = step.requiresReview || step.channel !== "email";
        if (step.channel === "email" && !prospect.email) {
          await prisma.prospectingActivity.upsert({ where: { idempotencyKey }, create: { workspaceId: campaign.workspaceId, campaignId: campaign.id, prospectId: prospect.id, stepId: step.id, idempotencyKey, channel: step.channel, action: "missing_channel", status: "skipped", detail: "Prospecto sin email", executedAt: now }, update: {} });
          await advanceProspect(prospect.id, campaign.id, nextStep, following?.delayHours || 0, completed, now); skipped++; continue;
        }
        if (step.channel.startsWith("linkedin_") && !prospect.linkedinUrl) {
          await prisma.prospectingActivity.upsert({ where: { idempotencyKey }, create: { workspaceId: campaign.workspaceId, campaignId: campaign.id, prospectId: prospect.id, stepId: step.id, idempotencyKey, channel: step.channel, action: "missing_channel", status: "skipped", detail: "Prospecto sin URL de LinkedIn", executedAt: now }, update: {} });
          await advanceProspect(prospect.id, campaign.id, nextStep, following?.delayHours || 0, completed, now); skipped++; continue;
        }
        if (needsManual) {
          await prisma.prospectingActivity.upsert({ where: { idempotencyKey }, create: { workspaceId: campaign.workspaceId, campaignId: campaign.id, prospectId: prospect.id, stepId: step.id, idempotencyKey, channel: step.channel, action: "execute_step", status: "awaiting_review", detail: body, scheduledAt: now }, update: { status: "awaiting_review" } });
          await prisma.prospectingProspect.update({ where: { id: prospect.id }, data: { status: "waiting_action" } });
          awaitingReview++; continue;
        }
        const subject = renderProspectingTemplate(step.subject || `Idea para ${prospect.companyName || "tu empresa"}`, tokens);
        await prisma.prospectingActivity.upsert({ where: { idempotencyKey }, create: { workspaceId: campaign.workspaceId, campaignId: campaign.id, prospectId: prospect.id, stepId: step.id, idempotencyKey, channel: "email", action: "send", status: "queued", detail: body, scheduledAt: now }, update: {} });
        const maySend = await prisma.prospectingProspect.count({ where: { id: prospect.id, campaignId: campaign.id, status: "processing" } });
        if (!maySend) continue;
        const result = await sendEmail({ to: prospect.email!, subject, text: body, html: `<div style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(body)}</div>`, workspaceId: campaign.workspaceId, from: LEADS_FROM, idempotencyKey });
        await prisma.prospectingActivity.update({ where: { idempotencyKey }, data: { status: "sent", externalId: result.id, executedAt: now, error: null } });
        await advanceProspect(prospect.id, campaign.id, nextStep, following?.delayHours || 0, completed, now); sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.$transaction([
          prisma.prospectingActivity.upsert({ where: { idempotencyKey }, create: { workspaceId: campaign.workspaceId, campaignId: campaign.id, prospectId: prospect.id, stepId: step.id, idempotencyKey, channel: step.channel, action: "execute_step", status: "failed", detail: body, error: message, scheduledAt: now, executedAt: now }, update: { status: "failed", error: message, executedAt: now } }),
          prisma.prospectingProspect.update({ where: { id: prospect.id }, data: { status: "active", nextActionAt: nextDate(1, now) } })
        ]);
        failed++;
      }
    }
    await prisma.prospectingCampaign.updateMany({ where: { id: campaign.id, engineLeaseUntil: leaseUntil }, data: { engineLeaseUntil: null } });
  }
  return { campaigns: campaigns.length, processed, sent, awaitingReview, skipped, failed };
}
