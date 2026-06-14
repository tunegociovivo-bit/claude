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
import { customerAuthOk } from "@/lib/bubui/customer-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = url.searchParams.has("lat") ? Number(url.searchParams.get("lat")) : null;
  const lng = url.searchParams.has("lng") ? Number(url.searchParams.get("lng")) : null;
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit") ?? 24)));

  // Sigue siendo público (customerId opcional). Pero si el usuario tiene sesión
  // y manda coords, aprovechamos para refrescar su última ubicación conocida
  // (panel admin), igual que en /offers. Fire-and-forget: no bloquea.
  const customerId = url.searchParams.get("customerId");
  if (customerId && lat != null && !Number.isNaN(lat) && lng != null && !Number.isNaN(lng)) {
    // Solo si la petición está autenticada como ese cliente (evita que alguien
    // falsee la ubicación de otro pasando un customerId ajeno). No bloquea los
    // resultados públicos de discover.
    if (await customerAuthOk(req, customerId)) {
      prisma.bubuiCustomer
        .update({ where: { id: customerId }, data: { lastLat: lat, lastLng: lng, lastLocationAt: new Date() } })
        .catch(() => {});
    }
  }

  const businesses = await prisma.bubuiBusiness.findMany({
    where: { active: true },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
      city: true,
      address: true,
      phone: true,
      latitude: true,
      longitude: true,
      logoUrl: true,
      brandColor: true,
      defaultDiscountPct: true,
      visibilityScore: true,
      featured: true,
      featuredUntil: true
    },
    orderBy: { visibilityScore: "desc" },
    take: 200
  });
  const nowTs = Date.now();

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
    // Destacado efectivo = el del admin O el premio del ranking mensual vigente.
    const featured = b.featured || (b.featuredUntil != null && b.featuredUntil.getTime() > nowTs);
    return { ...b, featured, distanceM, topInCategory: topIds.has(b.id) };
  });

  const sorted = withDistance.sort((a, b) => {
    // Los destacados (admin o premio del ranking) van siempre primero.
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    if (a.distanceM != null && b.distanceM != null) return a.distanceM - b.distanceM;
    if (a.distanceM != null) return -1;
    if (b.distanceM != null) return 1;
    return (b.visibilityScore ?? 0) - (a.visibilityScore ?? 0);
  });

  return NextResponse.json({ items: sorted.slice(0, limit) });
}
