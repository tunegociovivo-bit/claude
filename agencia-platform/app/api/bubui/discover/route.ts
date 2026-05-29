/**
 * GET /api/bubui/discover?lat=...&lng=...&limit=24
 *
 * Devuelve todos los negocios Bubui activos para que el cliente vea
 * la red completa antes de tener su primer cupón. Ordena por:
 *   1. Cercanía si llegan coordenadas (haversine, máx 10km).
 *   2. Visibility score (karma) en su defecto.
 *
 * No requiere customerId — es público para favorecer descubrimiento.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { haversineMeters } from "@/lib/bubui/core";
import { getTopBusinessIds } from "@/lib/bubui/topcategory";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = url.searchParams.has("lat") ? Number(url.searchParams.get("lat")) : null;
  const lng = url.searchParams.has("lng") ? Number(url.searchParams.get("lng")) : null;
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit") ?? 24)));

  const businesses = await prisma.bubuiBusiness.findMany({
    where: { active: true },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
      city: true,
      address: true,
      latitude: true,
      longitude: true,
      logoUrl: true,
      brandColor: true,
      defaultDiscountPct: true,
      visibilityScore: true,
      featured: true
    },
    orderBy: { visibilityScore: "desc" },
    take: 200
  });

  // "Top en categoría" — ranking ganado por ciudad. Anotamos cada negocio.
  // Cogemos las ciudades únicas de los resultados para no consultar todas.
  const cities = Array.from(new Set(businesses.map((b) => b.city)));
  const topIdSets = await Promise.all(cities.map((c) => getTopBusinessIds(c)));
  const topIds = new Set<string>();
  for (const s of topIdSets) for (const id of s) topIds.add(id);

  const withDistance = businesses.map((b) => {
    const distanceM =
      lat != null && lng != null && b.latitude != null && b.longitude != null
        ? Math.round(haversineMeters(lat, lng, b.latitude, b.longitude))
        : null;
    return { ...b, distanceM, topInCategory: topIds.has(b.id) };
  });

  const sorted = withDistance.sort((a, b) => {
    // Los destacados (admin) van siempre primero.
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    if (a.distanceM != null && b.distanceM != null) return a.distanceM - b.distanceM;
    if (a.distanceM != null) return -1;
    if (b.distanceM != null) return 1;
    return (b.visibilityScore ?? 0) - (a.visibilityScore ?? 0);
  });

  return NextResponse.json({ items: sorted.slice(0, limit) });
}
