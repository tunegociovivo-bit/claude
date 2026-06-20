/**
 * Mantenimiento automático del directorio Bubui (lo llama el planificador
 * interno una vez al día): geocodifica negocios que se dieron de alta sin
 * coordenadas, para que aparezcan en el mapa y en la página de su localidad.
 *
 * El contenido editorial IA NO se genera aquí: necesita la clave de IA de un
 * workspace concreto (facturación), así que se lanza manualmente desde el
 * panel /admin/bubui.
 */
import { prisma } from "@/lib/db/prisma";
import { geocodeAddress } from "@/lib/bubui/geocode";
import { fetchGoogleRatingByPlaceId, resolveGoogleRating } from "@/lib/bubui/google-rating";

const RATING_TTL_DAYS = 14;

export async function runBubuiGeoBackfill(limit = 20): Promise<{ updated: number; remaining: number }> {
  const pending = await prisma.bubuiBusiness.findMany({
    where: { OR: [{ latitude: null }, { longitude: null }] },
    select: { id: true, address: true, city: true, province: true },
    take: limit
  });
  if (pending.length === 0) return { updated: 0, remaining: 0 };

  let updated = 0;
  for (const b of pending) {
    const query = [b.address, b.city, b.province, "España"].filter(Boolean).join(", ");
    const geo = await geocodeAddress(query);
    if (!geo) continue;
    await prisma.bubuiBusiness.update({
      where: { id: b.id },
      data: {
        latitude: geo.latitude,
        longitude: geo.longitude,
        ...(geo.city ? { city: geo.city } : {}),
        ...(geo.province ? { province: geo.province } : {})
      }
    });
    updated++;
  }

  const remaining = await prisma.bubuiBusiness.count({ where: { OR: [{ latitude: null }, { longitude: null }] } });
  return { updated, remaining };
}

/**
 * Refresca la nota de Google de los negocios (para ordenar los rankings).
 * Prioriza los que nunca se han actualizado o llevan > RATING_TTL_DAYS días.
 * Si el negocio no tiene placeId, intenta resolverlo por nombre + ciudad.
 */
export async function runBubuiGoogleRatingRefresh(limit = 20): Promise<{ updated: number; remaining: number }> {
  const staleBefore = new Date(Date.now() - RATING_TTL_DAYS * 24 * 60 * 60 * 1000);
  const pending = await prisma.bubuiBusiness.findMany({
    where: {
      active: true,
      OR: [{ googleRatingUpdatedAt: null }, { googleRatingUpdatedAt: { lt: staleBefore } }]
    },
    select: { id: true, name: true, city: true, province: true, googlePlaceId: true },
    orderBy: { googleRatingUpdatedAt: { sort: "asc", nulls: "first" } },
    take: limit
  });
  if (pending.length === 0) return { updated: 0, remaining: 0 };

  let updated = 0;
  for (const b of pending) {
    const g = b.googlePlaceId
      ? await fetchGoogleRatingByPlaceId(b.googlePlaceId)
      : await resolveGoogleRating([b.name, b.city, b.province, "España"].filter(Boolean).join(", "));
    // Siempre marcamos el intento (para no reintentar en bucle si no hay match).
    await prisma.bubuiBusiness.update({
      where: { id: b.id },
      data: {
        googleRatingUpdatedAt: new Date(),
        ...(g && g.rating > 0
          ? {
              googleRating: g.rating,
              googleReviewsCount: g.reviews,
              ...(g.placeId && !b.googlePlaceId ? { googlePlaceId: g.placeId } : {})
            }
          : {})
      }
    });
    if (g && g.rating > 0) updated++;
  }

  const remaining = await prisma.bubuiBusiness.count({
    where: { active: true, OR: [{ googleRatingUpdatedAt: null }, { googleRatingUpdatedAt: { lt: staleBefore } }] }
  });
  return { updated, remaining };
}
