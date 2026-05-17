/**
 * GET    /api/v1/meta/campaigns/[id] → detalle con adsets+ads
 * DELETE /api/v1/meta/campaigns/[id] → soft delete
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { auditFromReq } from "@/lib/audit/log";

export const GET = withApi({}, async (_req, { params, api }) => {
  const c = await prisma.metaCampaign.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    include: {
      adsets: { include: { ads: true } },
      reviews: { orderBy: { generatedAt: "desc" }, take: 5 }
    }
  });
  if (!c) throw new ApiError(404, "not_found", "Campaña no encontrada");
  return NextResponse.json({ campaign: c });
});

export const DELETE = withApi({ rate: "destructive" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const r = await prisma.metaCampaign.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: api.userId }
  });
  if (r.count === 0) throw new ApiError(404, "not_found", "Campaña no encontrada");
  auditFromReq(req, api, {
    action: "meta_campaign.soft_delete",
    targetType: "META_CAMPAIGN",
    targetId: params.id
  });
  return NextResponse.json({ ok: true });
});
