/**
 * GET /api/v1/gmb/clients/[id]/competitors?keyword=&province=
 * Competencia ordenada por su posición real en Google Maps para la palabra clave principal,
 * buscando desde la provincia del negocio. Marca la posición de la propia ficha.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { MapsKeyMissingError } from "@/lib/integrations/google-maps";
import { provinceFromAddress, rankCompetitors } from "@/lib/gmb/competitor-ranking";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const c = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: {
      id: true,
      name: true,
      category: true,
      mainKeyword: true,
      address: true,
      rating: true,
      reviewCount: true,
      placeId: true,
      latitude: true,
      longitude: true
    }
  });
  if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const kws = await prisma.gmbKeyword
    .findMany({ where: { clientId: c.id, workspaceId: api.workspaceId }, select: { keyword: true, isPrimary: true }, orderBy: { createdAt: "asc" } })
    .catch(() => [] as { keyword: string; isPrimary: boolean }[]);

  const url = new URL(req.url);
  const primary = kws.find((k) => k.isPrimary)?.keyword;
  const keyword = (url.searchParams.get("keyword") || c.mainKeyword || primary || c.category || c.name).trim();
  const province = (url.searchParams.get("province") || url.searchParams.get("city") || provinceFromAddress(c.address)).trim();
  const keywords = Array.from(new Set([c.mainKeyword, ...kws.map((k) => k.keyword), c.category].map((k) => (k || "").trim()).filter(Boolean)));

  try {
    const r = await rankCompetitors({
      workspaceId: api.workspaceId,
      keyword,
      province,
      you: { name: c.name, placeId: c.placeId, lat: c.latitude, lng: c.longitude }
    });
    const others = r.results.filter((x) => !x.isYou);
    const top10 = others.slice(0, 10);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 0);
    const above = r.yourPosition ? others.filter((x) => x.position < r.yourPosition!).length : others.length;
    return NextResponse.json({
      query: `${keyword}${province ? ` · provincia de ${province}` : ""}`,
      keyword,
      province,
      keywords,
      source: r.source,
      yourPosition: r.yourPosition,
      total: r.results.length,
      above,
      client: { name: c.name, rating: c.rating, reviewCount: c.reviewCount },
      market: {
        avgRating: Number(avg(top10.map((x) => x.rating ?? 0).filter(Boolean)).toFixed(1)),
        avgReviews: Math.round(avg(top10.map((x) => x.reviewCount))),
        count: others.length
      },
      competitors: r.results
    });
  } catch (e: any) {
    if (e instanceof MapsKeyMissingError) throw new ApiError(503, "maps_key_missing", e.message);
    throw new ApiError(502, "maps_error", String(e?.message ?? e));
  }
});
