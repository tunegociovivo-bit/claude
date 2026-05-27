/**
 * POST /api/v1/meta/campaigns/[id]/ads/[adId]/regenerate
 * Body: { customPrompt?: string, regenerateCopy?: boolean }
 *
 * Re-genera UN anuncio concreto. Si llega `customPrompt` se persiste
 * en MetaAd.userNotes y se pasa como prompt principal al generador
 * (en lugar del imagePrompt que produjo Claude). Esto permite al
 * user reformular libremente cuando el resultado por defecto no
 * convence: "lo mismo pero la persona en exterior", "haz la paleta
 * mucho más oscura", etc.
 *
 * regenerateCopy: si true, también pedimos a Claude nuevo copy. Si
 * false (default), conservamos headline/primaryText y solo regen
 * la imagen.
 *
 * Long-running: el pesado va en background con setImmediate; el
 * endpoint devuelve 202 enseguida y la UI hace polling al detalle.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { regenerateOneAd } from "@/lib/meta/generate-content";
import { auditFromReq } from "@/lib/audit/log";

const bodySchema = z.object({
  customPrompt: z.string().max(2000).optional(),
  regenerateCopy: z.boolean().optional()
});

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "*", rate: "ai" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const campaign = await prisma.metaCampaign.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");

  const ad = await prisma.metaAd.findFirst({
    where: { id: params.adId, adset: { campaignId: campaign.id } },
    include: { adset: true }
  });
  if (!ad) throw new ApiError(404, "ad_not_found", "Anuncio no encontrado");

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const customPrompt = parsed.data.customPrompt?.trim();
  const regenerateCopy = !!parsed.data.regenerateCopy;

  // Persist instrucciones del user + paso a GENERATING para que el
  // front lo vea al instante.
  await prisma.metaAd.update({
    where: { id: ad.id },
    data: {
      contentStatus: "GENERATING",
      lastError: null,
      ...(customPrompt !== undefined ? { userNotes: customPrompt || null } : {})
    }
  });

  auditFromReq(req, api, {
    action: "meta_campaign.ad_regenerate",
    targetType: "META_AD",
    targetId: ad.id,
    meta: { hasCustomPrompt: !!customPrompt, regenerateCopy }
  });

  setImmediate(() => {
    regenerateOneAd({
      workspaceId: api.workspaceId,
      campaignId: campaign.id,
      adId: ad.id,
      customPrompt: customPrompt || null,
      regenerateCopy
    }).catch(async (err) => {
      console.error(`[meta] regenerate-ad fatal for ${ad.id}:`, err);
      await prisma.metaAd
        .update({
          where: { id: ad.id },
          data: { contentStatus: "FAILED", lastError: String(err?.message ?? err).slice(0, 800) }
        })
        .catch(() => {});
    });
  });

  return NextResponse.json({ ok: true, status: "regenerating" }, { status: 202 });
});
