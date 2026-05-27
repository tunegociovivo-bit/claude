/**
 * GET /api/v1/admin/meta/debug-generation?campaignId=...
 *
 * Diagnóstico de la generación de imágenes. Devuelve:
 *  - status de la campaña + lastError
 *  - por cada ad: id, format, contentStatus, lastError, urls, edad
 *    del último update (ms)
 *  - resumen: cuántos en cada estado
 *  - si hay ads en GENERATING desde hace > 5 min, los marca como
 *    "probablemente atascados" — el user puede entonces forzar
 *    su reset a PLACEHOLDER para reintentar.
 *
 * Solo admin del workspace.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaignId");
  if (!campaignId) throw new ApiError(400, "missing", "Pasa campaignId");

  const campaign = await prisma.metaCampaign.findFirst({
    where: { id: campaignId, workspaceId: api.workspaceId },
    include: { adsets: { include: { ads: true } } }
  });
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");

  const now = Date.now();
  const STUCK_MS = 5 * 60_000; // > 5 min en GENERATING → probablemente atascado
  // MetaAd no tiene updatedAt propio (no se quiso cargar la tabla
  // con autoupdates en cada cambio masivo). Usamos updatedAt de la
  // campaña como referencia común: si la campaña no se ha tocado en
  // 5 min y aún hay ads en GENERATING, están atascados.
  const campaignAgeMs = now - new Date(campaign.updatedAt).getTime();

  const ads = campaign.adsets.flatMap((adset) =>
    adset.ads.map((ad) => {
      const stuck =
        ad.contentStatus === "GENERATING" && campaignAgeMs > STUCK_MS;
      return {
        id: ad.id,
        adsetLabel: adset.label,
        format: ad.format,
        contentStatus: ad.contentStatus,
        lastError: ad.lastError,
        mediaUrlsCount: Array.isArray(ad.mediaUrls) ? ad.mediaUrls.length : 0,
        hasMediaVariants: !!ad.mediaVariants,
        stuck
      };
    })
  );

  const byStatus = ads.reduce((acc: Record<string, number>, a) => {
    acc[a.contentStatus] = (acc[a.contentStatus] ?? 0) + 1;
    return acc;
  }, {});

  const stuckCount = ads.filter((a) => a.stuck).length;

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      lastError: campaign.lastError,
      updatedAt: campaign.updatedAt,
      ageSeconds: Math.round((now - new Date(campaign.updatedAt).getTime()) / 1000)
    },
    summary: {
      total: ads.length,
      byStatus,
      stuckCount
    },
    ads
  });
});

/**
 * POST /api/v1/admin/meta/debug-generation?campaignId=...
 *  body opcional: { resetStuck: true }
 *
 * Si resetStuck=true, marca como PLACEHOLDER todos los ads que
 * llevan más de 5 min en GENERATING. Útil para "destascar" una
 * campaña que se quedó colgada y volver a darle a "Generar con IA".
 */
export const POST = withApi({ scope: "*", rate: "destructive" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaignId");
  if (!campaignId) throw new ApiError(400, "missing", "Pasa campaignId");

  const body = await req.json().catch(() => ({}));
  if (!body?.resetStuck) {
    throw new ApiError(400, "bad_body", "Pasa {resetStuck:true} para resetear ads atascados");
  }

  const campaign = await prisma.metaCampaign.findFirst({
    where: { id: campaignId, workspaceId: api.workspaceId }
  });
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");

  // MetaAd no tiene updatedAt → comprobamos la edad de la campaña.
  // Si la campaña no se ha tocado en 5 min, asumimos que cualquier
  // ad en GENERATING está atascado.
  const cutoff = Date.now() - 5 * 60_000;
  if (new Date(campaign.updatedAt).getTime() > cutoff) {
    return NextResponse.json({
      ok: false,
      reason: "campaign_recently_updated",
      message: "La campaña se actualizó hace menos de 5 min — espera un poco antes de resetear."
    });
  }
  const r = await prisma.metaAd.updateMany({
    where: {
      adset: { campaignId: campaign.id },
      contentStatus: "GENERATING"
    },
    data: { contentStatus: "PLACEHOLDER", lastError: "Reseteado por admin (atascado >5min)" }
  });
  // Si la campaña entera estaba en LAUNCHING, la devolvemos a DRAFT
  // para que el user pueda pulsar "Generar con IA" otra vez.
  if (campaign.status === "LAUNCHING") {
    await prisma.metaCampaign.update({
      where: { id: campaign.id },
      data: { status: "DRAFT", lastError: "Reset por admin" }
    });
  }
  return NextResponse.json({ ok: true, reset: r.count });
});
