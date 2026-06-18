/**
 * POST /api/v1/leads/[id]/harvest-competitors
 *
 * "Cosecha de competencia": consulta el ranking del lead en Google y crea como
 * leads NUEVOS los competidores que aún no tienes (sin tocar los existentes).
 * Cada lead que miras puede generar hasta 5 leads más, reutilizando el trabajo
 * del informe de posicionamiento.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getCompetitorRanking } from "@/lib/leads/competitors";

export const runtime = "nodejs";

export const POST = withApi({ scope: "*", rate: "admin" }, async (_req, { params, api }) => {
  const lead = await prisma.lead.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: {
      id: true,
      placeId: true,
      name: true,
      category: true,
      types: true,
      province: true,
      formattedAddress: true,
      address: true,
      latitude: true,
      longitude: true,
      rating: true,
      reviewsCount: true
    }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");

  let data;
  try {
    data = await getCompetitorRanking(api.workspaceId, lead as any, { harvest: true });
  } catch (e: any) {
    throw new ApiError(400, "ranking_error", e?.message ?? "No se pudo consultar Google Places.");
  }
  if (!data) {
    throw new ApiError(400, "no_ranking", "No se encontraron competidores (revisa categoría/zona del lead y la API key de Places).");
  }

  const created = data.harvested?.created ?? 0;
  const skipped = data.harvested?.skipped ?? 0;
  return NextResponse.json({
    ok: true,
    created,
    skipped,
    total: data.total,
    message:
      created > 0
        ? `Cosechados ${created} competidores como leads nuevos${skipped ? ` (${skipped} ya existían)` : ""}.`
        : `No había competidores nuevos que cosechar${skipped ? ` (${skipped} ya los tenías)` : ""}.`
  });
});
