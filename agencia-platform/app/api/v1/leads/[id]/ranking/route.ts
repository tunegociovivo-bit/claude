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
import { renderRankingPng } from "@/lib/leads/ranking-card";

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

  let data;
  try {
    data = await getCompetitorRanking(api.workspaceId, lead as any);
  } catch (e: any) {
    // Surface el error REAL de Google Places (clave/permiso/cuota) en vez de un
    // "internal_error" opaco, para poder diagnosticarlo desde la propia UI.
    throw new ApiError(400, "ranking_error", e?.message ?? "No se pudo consultar Google Places para el ranking.");
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: "no_ranking", message: "No se pudo obtener el ranking de Google (revisa categoría/zona del lead y la API key de Places)." } },
      { status: 400 }
    );
  }
  // Renderizamos a Buffer DENTRO del handler (igual que el mockup): si el render
  // fallara durante el streaming, sería un 502 indiagnosticable; bufferizando
  // aquí cualquier error se captura y se devuelve como JSON.
  let png: Buffer;
  try {
    png = await renderRankingPng(data);
  } catch (e: any) {
    throw new ApiError(500, "ranking_render_error", `No se pudo generar la imagen del ranking: ${e?.message ?? e}`);
  }
  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" }
  });
});
