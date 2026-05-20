/**
 * GET    /api/v1/meta/campaigns/[id] → detalle con adsets+ads
 * DELETE /api/v1/meta/campaigns/[id] → soft delete
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { auditFromReq } from "@/lib/audit/log";
import { resignUrlIfNeeded } from "@/lib/storage/resign";

// Re-firma una estructura de variantes (objeto {square,portrait,...} o
// array de esos objetos para carrusel). Las URLs de R2 se firman al
// generar y caducan en 1h; sin esto, las imágenes de anuncios salen
// rotas pasado ese rato.
async function resignVariants(v: any): Promise<any> {
  if (!v) return v;
  if (Array.isArray(v)) return Promise.all(v.map((x) => resignVariants(x)));
  if (typeof v === "object") {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = typeof val === "string" ? await resignUrlIfNeeded(val) : val;
    }
    return out;
  }
  return v;
}

export const GET = withApi({}, async (_req, { params, api }) => {
  const c = await prisma.metaCampaign.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    include: {
      adsets: { include: { ads: true } },
      reviews: { orderBy: { generatedAt: "desc" }, take: 5 }
    }
  });
  if (!c) throw new ApiError(404, "not_found", "Campaña no encontrada");

  // Re-firmar URLs de imágenes de cada anuncio (mediaUrls + mediaVariants).
  for (const adset of c.adsets) {
    for (const ad of adset.ads) {
      if (Array.isArray(ad.mediaUrls) && ad.mediaUrls.length > 0) {
        ad.mediaUrls = (await Promise.all(ad.mediaUrls.map((u) => resignUrlIfNeeded(u)))).filter(
          (u): u is string => !!u
        );
      }
      if (ad.mediaVariants) {
        (ad as any).mediaVariants = await resignVariants(ad.mediaVariants);
      }
    }
  }

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
