/**
 * GET  /api/v1/meta/campaigns       → lista paginada
 * POST /api/v1/meta/campaigns       → crea (DRAFT) + Task asociada
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { createCampaign, createCampaignSchema } from "@/lib/meta/campaigns";
import { auditFromReq } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

export const GET = withApi({}, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  const items = await prisma.metaCampaign.findMany({
    where: {
      workspaceId: api.workspaceId,
      deletedAt: null,
      ...(status ? { status: status as any } : {})
    },
    include: {
      _count: { select: { adsets: true } },
      adsets: { select: { _count: { select: { ads: true } } } }
    },
    orderBy: { updatedAt: "desc" },
    take: limit
  });
  return NextResponse.json({
    items: items.map((c) => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      dailyBudgetCents: c.dailyBudgetCents,
      adsetsCount: c._count.adsets,
      adsCount: c.adsets.reduce((sum, a) => sum + a._count.ads, 0),
      createdAt: c.createdAt
    }))
  });
});

export const POST = withApi({ rate: "destructive" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const raw = await req.json().catch(() => null);
  const parsed = createCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "));
  }
  const campaign = await createCampaign({
    workspaceId: api.workspaceId,
    actorId: api.userId,
    data: parsed.data
  });
  auditFromReq(req, api, {
    action: "meta_campaign.create",
    targetType: "META_CAMPAIGN",
    targetId: campaign.id,
    meta: {
      name: campaign.name,
      objective: campaign.objective,
      adsetsCount: campaign.adsets.length
    }
  });
  return NextResponse.json({ ok: true, campaign });
});
