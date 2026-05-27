/**
 * POST /api/v1/meta/campaigns/[id]/generate-content
 *
 * Dispara la generación de copy + imágenes para todos los anuncios
 * de la campaña con Claude + OpenAI gpt-image-1. Long-running: cada
 * imagen tarda ~10-30s y se generan hasta CONCURRENT en paralelo.
 *
 * Estrategia: el endpoint VUELVE INMEDIATAMENTE tras pasar la
 * campaña a status GENERATING (y todos los ads pendientes a
 * GENERATING). El trabajo real corre con waitUntil() o un setTimeout
 * en background. El frontend hace polling al detalle de la campaña
 * y ve los ads cambiar a READY_FOR_REVIEW.
 *
 * Idempotencia: solo procesa ads en estado PLACEHOLDER o FAILED.
 * Si quieres re-generar un ad APPROVED, primero ponlo en FAILED
 * desde la UI (botón "Regenerar").
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { generateAllContent } from "@/lib/meta/generate-content";
import { auditFromReq } from "@/lib/audit/log";

export const dynamic = "force-dynamic";
// Indicamos a Next/Railway que esta ruta puede tardar.
export const maxDuration = 60; // segundos. Si tarda más, el background sigue corriendo.

export const POST = withApi({ rate: "ai" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const campaign = await prisma.metaCampaign.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true, status: true, name: true }
  });
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");
  if (campaign.status === "LAUNCHING" || campaign.status === "ACTIVE") {
    throw new ApiError(400, "campaign_running", "La campaña ya está en Meta. No se puede regenerar contenido.");
  }

  // Marca la campaña + ads pendientes como GENERATING para que el front
  // vea el estado al instante.
  await prisma.metaCampaign.update({
    where: { id: campaign.id },
    data: { status: "LAUNCHING", lastError: null } // reusamos LAUNCHING como "trabajando"
  });
  await prisma.metaAd.updateMany({
    where: {
      adset: { campaignId: campaign.id },
      contentStatus: { in: ["PLACEHOLDER", "FAILED"] }
    },
    data: { contentStatus: "GENERATING", lastError: null }
  });

  auditFromReq(req, api, {
    action: "meta_campaign.generate_content_started",
    targetType: "META_CAMPAIGN",
    targetId: campaign.id
  });

  // Arrancamos el trabajo en background. No esperamos.
  // Si Railway corta la lambda antes de terminar, los ads que no
  // se completaron quedarán en GENERATING — un cron de limpieza
  // los pasaría a FAILED tras X minutos (TODO Fase 3).
  setImmediate(() => {
    generateAllContent({ workspaceId: api.workspaceId, campaignId: campaign.id })
      .then(async (report) => {
        console.log(`[meta] generate-content done for ${campaign.id}:`, report);
      })
      .catch(async (err) => {
        console.error(`[meta] generate-content FATAL for ${campaign.id}:`, err);
        await prisma.metaCampaign
          .update({
            where: { id: campaign.id },
            data: { status: "FAILED", lastError: String(err?.message ?? err).slice(0, 800) }
          })
          .catch(() => {});
      });
  });

  return NextResponse.json({
    ok: true,
    message: "Generación arrancada. La página se actualiza sola conforme cada anuncio esté listo."
  });
});
