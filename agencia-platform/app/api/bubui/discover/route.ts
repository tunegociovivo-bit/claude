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
  const requestedLimit = Number(url.searchParams.get("limit") ?? 24);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if ((lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) || (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180)) || (lat === null) !== (lng === null) || !Number.isInteger(requestedLimit) || requestedLimit < 1 || !Number.isInteger(offset) || offset < 0 || offset > 10000) return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  const limit = Math.min(60, requestedLimit);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const category = url.searchParams.get("category") ?? "Todo";
  const categoryTerms: Record<string, string[]> = { Restau: ["restau", "bar", "comida", "pizzer"], "Café": ["café", "cafe", "cafeter", "panader"], Belleza: ["belleza", "peluquer", "estét", "estet", "uñas"], Tienda: ["tienda", "comercio", "moda"], Fitness: ["fitness", "entrenamiento", "gimnasio", "deporte", "pilates", "yoga"] };
  const filters: any[] = [];
  if (query) filters.push({ OR: ["name", "category", "city"].map(field => ({ [field]: { contains: query, mode: "insensitive" } })) });
  if (category !== "Todo") filters.push({ OR: (categoryTerms[category] ?? [category]).map(term => ({ category: { contains: term, mode: "insensitive" } })) });
  const geo = lat !== null && lng !== null ? { latitude: { gte: Math.max(-90, lat - 0.1), lte: Math.min(90, lat + 0.1) }, longitude: { gte: lng - Math.min(180, 0.1 / Math.max(0.001, Math.cos(lat * Math.PI / 180))), lte: lng + Math.min(180, 0.1 / Math.max(0.001, Math.cos(lat * Math.PI / 180))) } } : {};

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
    where: { active: true, ...geo, ...(filters.length ? { AND: filters } : {}) },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
      city: true,
      address: true,
      phone: true,
      websiteUrl: true,
      instagramUrl: true,
      facebookUrl: true,
      tiktokUrl: true,
      latitude: true,
      longitude: true,
      logoUrl: true,
      coverImageUrl: true,
      brandColor: true,
      defaultDiscountPct: true,
      visibilityScore: true,
      featured: true,
      featuredUntil: true
    },
    orderBy: { visibilityScore: "desc" }
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

  const sorted = withDistance.filter(b => lat === null || (b.distanceM !== null && b.distanceM <= 10000)).sort((a, b) => {
    // Los destacados (admin o premio del ranking) van siempre primero.
    if (a.distanceM != null && b.distanceM != null) return a.distanceM - b.distanceM;
    if (a.distanceM != null) return -1;
    if (b.distanceM != null) return 1;
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return (b.visibilityScore ?? 0) - (a.visibilityScore ?? 0);
  });

  return NextResponse.json({ items: sorted.slice(offset, offset + limit), hasMore: sorted.length > offset + limit, nextOffset: offset + limit });
}
