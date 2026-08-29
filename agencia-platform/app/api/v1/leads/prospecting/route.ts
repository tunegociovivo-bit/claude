import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const stepSchema = z.object({
  channel: z.enum(["linkedin_visit", "linkedin_connect", "linkedin_message", "email", "whatsapp", "task"]),
  delayHours: z.number().int().min(0).max(24 * 90),
  templateBody: z.string().max(12000).optional().default(""),
  subject: z.string().max(240).optional(),
  stopOnReply: z.boolean().default(true),
  requiresReview: z.boolean().default(false)
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

  return NextResponse.json({
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      stats: grouped
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
        create: data.steps.map((step, order) => ({ ...step, order }))
      }
    },
    include: { steps: { orderBy: { order: "asc" } } }
  });
  return NextResponse.json({ campaign }, { status: 201 });
});

const updateSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["activate", "pause", "archive", "resume"])
});

export const PATCH = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const current = await prisma.prospectingCampaign.findFirst({
    where: { id: parsed.data.id, workspaceId: api.workspaceId },
    include: { steps: { orderBy: { order: "asc" }, take: 1 } }
  });
  if (!current) throw new ApiError(404, "not_found", "Campaña no encontrada");

  const status = parsed.data.action === "archive" ? "archived" : parsed.data.action === "pause" ? "paused" : "active";
  const now = new Date();
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
