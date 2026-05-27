/**
 * GET /api/v1/gmb/clients/[id]/competitors → competidores cercanos vía Maps
 * Places (textsearch por keyword/categoría + ciudad). Necesita Maps API key.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { placesTextSearch, MapsKeyMissingError } from "@/lib/integrations/google-maps";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const c = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, name: true, category: true, mainKeyword: true, address: true, rating: true, reviewCount: true }
  });
  if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const url = new URL(req.url);
  const city = url.searchParams.get("city") ?? (c.address || "").split(",").slice(-2).join(" ").trim();
  const term = (c.mainKeyword || c.category || c.name).trim();
  const query = [term, city].filter(Boolean).join(" en ");

  try {
    const results = await placesTextSearch({ workspaceId: api.workspaceId, query, limit: 12 });
    // Excluir la propia ficha por nombre aproximado
    const competitors = results.filter((r) => r.name.toLowerCase() !== c.name.toLowerCase());
    const avgRating = competitors.length
      ? Number((competitors.reduce((s, r) => s + r.rating, 0) / competitors.length).toFixed(1))
      : 0;
    const avgReviews = competitors.length
      ? Math.round(competitors.reduce((s, r) => s + r.reviewCount, 0) / competitors.length)
      : 0;
    return NextResponse.json({
      query,
      client: { name: c.name, rating: c.rating, reviewCount: c.reviewCount },
      market: { avgRating, avgReviews, count: competitors.length },
      competitors: competitors
        .sort((a, b) => b.reviewCount - a.reviewCount)
        .map((r) => ({ name: r.name, address: r.address, rating: r.rating, reviewCount: r.reviewCount }))
    });
  } catch (e: any) {
    if (e instanceof MapsKeyMissingError) throw new ApiError(503, "maps_key_missing", e.message);
    throw new ApiError(502, "maps_error", String(e?.message ?? e));
  }
});
