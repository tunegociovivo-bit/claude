/**
 * GET /api/v1/leads/[id]/ranking
 * Devuelve el PNG del informe "tú vs tu competencia en Google" del lead, para
 * previsualizarlo antes de enviarlo. (El envío es POST /send-ranking.)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getCompetitorRanking } from "@/lib/leads/competitors";
import { buildRankingImage } from "@/lib/leads/ranking-card";

export const runtime = "nodejs";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
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

  const data = await getCompetitorRanking(api.workspaceId, lead as any);
  if (!data) {
    return NextResponse.json(
      { error: { code: "no_ranking", message: "No se pudo obtener el ranking de Google (revisa categoría/zona del lead y la API key de Places)." } },
      { status: 400 }
    );
  }
  // withApi pasa el Response tal cual; ImageResponse es un Response válido.
  return buildRankingImage(data) as unknown as NextResponse;
});
