import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import type { Prisma } from "@prisma/client";

const stepSchema = z.object({
  channel: z.enum(["linkedin_visit", "linkedin_connect", "linkedin_message", "email", "whatsapp", "task"]),
  delayHours: z.number().int().min(0).max(24 * 90),
  templateBody: z.string().max(12000).optional().default(""),
  subject: z.string().max(240).optional(),
  stopOnReply: z.boolean().default(true),
  requiresReview: z.boolean().default(false),
  condition: z.object({ field: z.enum(["email", "phone", "linkedin", "score", "status", "replied"]).optional(), operator: z.enum(["exists", "missing", "gte", "equals"]).optional(), value: z.union([z.string(), z.number(), z.boolean()]).optional(), onFalse: z.enum(["skip", "stop"]).optional() }).nullable().optional(),
  variants: z.array(z.object({ body: z.string().max(12000).optional(), subject: z.string().max(240).optional() })).max(5).nullable().optional(),
  personalization: z.enum(["template", "ai_research", "ai_company"]).default("template")
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  source: z.enum(["linkedin", "sales_navigator", "csv", "manual"]).default("linkedin"),
  sourceUrl: z.string().trim().url().optional().or(z.literal("")),
  objective: z.enum(["reply", "phone", "meeting"]).default("meeting"),
  dailyLimit: z.number().int().min(1).max(500).default(30),
  steps: z.array(stepSchema).min(1).max(12)
});

export const GET = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const campaignId = new URL(req.url).searchParams.get("campaignId");
  const campaigns = await prisma.prospectingCampaign.findMany({
    where: { workspaceId: api.workspaceId, ...(campaignId ? { id: campaignId } : {}) },
    include: {
      steps: { orderBy: { order: "asc" } },
      prospects: { orderBy: { createdAt: "desc" }, take: campaignId ? 500 : 20 },
      activities: { include: { prospect: true }, orderBy: { createdAt: "desc" }, take: campaignId ? 100 : 10 }
    },
    orderBy: { updatedAt: "desc" }
  });

  const ids = campaigns.map((campaign) => campaign.id);
  const grouped = ids.length
    ? await prisma.prospectingProspect.groupBy({
        by: ["campaignId", "status"],
        where: { workspaceId: api.workspaceId, campaignId: { in: ids } },
        _count: { _all: true }
      })
    : [];
  const activityGrouped = ids.length
    ? await prisma.prospectingActivity.groupBy({
        by: ["campaignId", "status"],
        where: { workspaceId: api.workspaceId, campaignId: { in: ids } },
        _count: { _all: true }
      })
    : [];

  return NextResponse.json({
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      stats: grouped
        .filter((row) => row.campaignId === campaign.id)
        .reduce<Record<string, number>>((acc, row) => {
          acc[row.status] = row._count._all;
          return acc;
        }, {}),
      activityStats: activityGrouped
        .filter((row) => row.campaignId === campaign.id)
        .reduce<Record<string, number>>((acc, row) => {
          acc[row.status] = row._count._all;
          return acc;
        }, {})
    }))
  });
});

export const POST = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const data = parsed.data;
  const campaign = await prisma.prospectingCampaign.create({
    data: {
      workspaceId: api.workspaceId,
      name: data.name,
      source: data.source,
      sourceUrl: data.sourceUrl || null,
      objective: data.objective,
      dailyLimit: data.dailyLimit,
      activeWeekdays: [1, 2, 3, 4, 5],
      steps: {
        create: data.steps.map((step, order) => ({ ...step, condition: step.condition || undefined, variants: step.variants || undefined, order }))
      }
    },
    include: { steps: { orderBy: { order: "asc" } } }
  });
  return NextResponse.json({ campaign }, { status: 201 });
});

const updateSchema = z.discriminatedUnion("action", [
  z.object({ id: z.string().min(1), action: z.enum(["activate", "pause", "archive", "resume"]) }),
  z.object({
    id: z.string().min(1), action: z.literal("update"),
    name: z.string().trim().min(2).max(120), dailyLimit: z.number().int().min(1).max(500),
    startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24),
    activeWeekdays: z.array(z.number().int().min(0).max(6)).min(1),
    steps: z.array(stepSchema).min(1).max(12)
  })
]);

export const PATCH = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const current = await prisma.prospectingCampaign.findFirst({
    where: { id: parsed.data.id, workspaceId: api.workspaceId },
    include: { steps: { orderBy: { order: "asc" } } }
  });
  if (!current) throw new ApiError(404, "not_found", "Campaña no encontrada");

  if (parsed.data.action === "update") {
    const data = parsed.data;
    if (data.endHour <= data.startHour) throw new ApiError(400, "validation_error", "La hora final debe ser posterior a la inicial");
    const campaign = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "ProspectingCampaign"
        WHERE "id" = ${current.id} AND "workspaceId" = ${api.workspaceId}
        FOR UPDATE
      `;
      if (!locked.length) throw new ApiError(404, "not_found", "Campaña no encontrada");
      if (!["draft", "paused"].includes(locked[0].status)) throw new ApiError(409, "campaign_active", "Pausa la campaña antes de editarla");
      const fresh = await tx.prospectingCampaign.findUnique({ where: { id: current.id }, include: { steps: { orderBy: { order: "asc" } } } });
      if (!fresh) throw new ApiError(404, "not_found", "Campaña no encontrada");
      const normalizedCurrent = fresh.steps.map(({ channel, delayHours, templateBody, subject, stopOnReply, requiresReview, condition, variants, personalization }) => ({ channel, delayHours, templateBody: templateBody || "", subject: subject || undefined, stopOnReply, requiresReview, condition, variants, personalization }));
      const cadenceChanged = JSON.stringify(normalizedCurrent) !== JSON.stringify(data.steps);
      if (cadenceChanged) {
        const activityCount = await tx.prospectingActivity.count({ where: { campaignId: current.id, workspaceId: api.workspaceId } });
        if (activityCount) throw new ApiError(409, "cadence_started", "La cadencia ya tiene actividad. Puedes cambiar horario y límite, pero no sus pasos.");
      }
      if (cadenceChanged) await tx.prospectingStep.deleteMany({ where: { campaignId: current.id } });
      return tx.prospectingCampaign.update({
        where: { id: current.id },
        data: {
          name: data.name, dailyLimit: data.dailyLimit, startHour: data.startHour, endHour: data.endHour,
          activeWeekdays: [...new Set(data.activeWeekdays)].sort(),
          ...(cadenceChanged ? { steps: { create: data.steps.map((step, order) => ({ ...step, condition: step.condition || undefined, variants: step.variants || undefined, order })) } } : {})
        },
        include: { steps: { orderBy: { order: "asc" } } }
      });
    });
    return NextResponse.json({ campaign });
  }

  const status = parsed.data.action === "archive" ? "archived" : parsed.data.action === "pause" ? "paused" : "active";
  const now = new Date();
  if (status === "active") {
    const runnableStatuses = ["pending", "active"];
    const channels = new Set(current.steps.map((step) => step.channel));
    const contactFilters: Prisma.ProspectingProspectWhereInput[] = [];
    if (["linkedin_visit", "linkedin_connect", "linkedin_message"].some((channel) => channels.has(channel))) contactFilters.push({ linkedinUrl: { not: null } });
    if (channels.has("email")) contactFilters.push({ email: { not: null } });
    if (channels.has("whatsapp")) contactFilters.push({ phone: { not: null } });
    if (channels.has("task")) contactFilters.push({ id: { not: "" } });
    const [totalProspects, reachableProspects] = await Promise.all([
      prisma.prospectingProspect.count({ where: { campaignId: current.id, workspaceId: api.workspaceId, status: { in: runnableStatuses } } }),
      contactFilters.length ? prisma.prospectingProspect.count({ where: { campaignId: current.id, workspaceId: api.workspaceId, status: { in: runnableStatuses }, OR: contactFilters } }) : 0
    ]);
    if (!totalProspects) throw new ApiError(409, "campaign_empty", "Importa al menos un prospecto antes de activar la campa\u00f1a");
    if (!reachableProspects) throw new ApiError(409, "campaign_unreachable", "Ning\u00fan prospecto tiene LinkedIn, email o WhatsApp compatible con esta cadencia");
  }
  const campaign = await prisma.$transaction(async (tx) => {
    const updated = await tx.prospectingCampaign.update({ where: { id: current.id }, data: { status, ...(status === "paused" ? { engineLeaseUntil: null } : {}) } });
    if (status === "active") {
      await tx.prospectingProspect.updateMany({
        where: { campaignId: current.id, workspaceId: api.workspaceId, status: "pending" },
        data: { status: "active", nextActionAt: now }
      });
    }
    if (status === "paused") {
      await tx.prospectingProspect.updateMany({
        where: { campaignId: current.id, workspaceId: api.workspaceId, status: "processing" },
        data: { status: "active", nextActionAt: now }
      });
      await tx.prospectingActivity.updateMany({
        where: { campaignId: current.id, workspaceId: api.workspaceId, status: "queued" },
        data: { status: "skipped", detail: "Campaña pausada por un administrador" }
      });
    }
    return updated;
  });
  return NextResponse.json({ campaign });
});
