/**
 * GET /api/v1/leads/queue/[id]/ranking.png
 * Imagen de posicionamiento de un mensaje EN COLA, renderizada desde su
 * snapshot guardado (mismos datos que el texto/pie), para que la preview
 * coincida exactamente con lo que se enviará. Si el mensaje no tiene snapshot
 * (mensajes antiguos), cae a una consulta en vivo por el lead.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getCompetitorRanking } from "@/lib/leads/competitors";
import { renderRankingPng } from "@/lib/leads/ranking-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const msg = await prisma.leadMessage.findFirst({
    where: { id: (params as any).id, workspaceId: api.workspaceId },
    select: { id: true, leadId: true, rankingSnapshot: true }
  });
  if (!msg) throw new ApiError(404, "not_found", "Mensaje no encontrado");

  let data: any = msg.rankingSnapshot ?? null;
  if (!data) {
    const lead = await prisma.lead.findFirst({
      where: { id: msg.leadId, workspaceId: api.workspaceId },
      select: {
        id: true, placeId: true, name: true, category: true, types: true, province: true,
        formattedAddress: true, address: true, latitude: true, longitude: true, rating: true, reviewsCount: true
      }
    });
    if (lead) data = await getCompetitorRanking(api.workspaceId, lead as any, { store: false, harvest: false });
  }
  if (!data) throw new ApiError(400, "no_ranking", "No hay datos de ranking para este mensaje.");

  const png = await renderRankingPng(data);
  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" }
  });
});
