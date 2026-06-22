/**
 * Nota de Google (Business Profile) para ordenar los rankings del directorio.
 *
 * Usa la Places API (New) con la key de entorno. Dos vías:
 *  - Por placeId (si el negocio ya lo tiene) → Place Details.
 *  - Por nombre + ciudad (text search) → resuelve placeId + nota de una vez,
 *    útil para negocios dados de alta sin placeId.
 *
 * Degradación elegante: si no hay key o falla, devuelve null.
 */

const KEY = () => process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;

export type GoogleRating = { placeId: string | null; rating: number; reviews: number };

/** Nota + nº de reseñas de un place concreto. */
export async function fetchGoogleRatingByPlaceId(placeId: string): Promise<GoogleRating | null> {
  const key = KEY();
  if (!key || !placeId) return null;
  try {
    const resp = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,rating,userRatingCount" },
      signal: AbortSignal.timeout(12000)
    });
    if (!resp.ok) return null;
    const p: any = await resp.json().catch(() => null);
    if (!p || typeof p.rating !== "number") return null;
    return { placeId: p.id ?? placeId, rating: p.rating, reviews: p.userRatingCount ?? 0 };
  } catch {
    return null;
  }
}

/** Resuelve placeId + nota por nombre + ciudad (para negocios sin placeId). */
export async function resolveGoogleRating(query: string): Promise<GoogleRating | null> {
  const key = KEY();
  if (!key || !query.trim()) return null;
  try {
    const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.rating,places.userRatingCount"
      },
      body: JSON.stringify({ textQuery: query, languageCode: "es", regionCode: "ES", pageSize: 1 }),
      signal: AbortSignal.timeout(12000)
    });
    if (!resp.ok) return null;
    const data: any = await resp.json().catch(() => null);
    const p = data?.places?.[0];
    if (!p) return null;
    return { placeId: p.id ?? null, rating: typeof p.rating === "number" ? p.rating : 0, reviews: p.userRatingCount ?? 0 };
  } catch {
    return null;
  }
}
