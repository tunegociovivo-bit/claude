/**
 * Helper para construir el link público de "Escribir reseña en
 * Google" para una ficha de Google Business Profile.
 *
 * Formato whitespark / oficial Google:
 *   https://search.google.com/local/writereview?placeid=<PLACE_ID>
 *
 * El PLACE_ID se obtiene desde:
 *   https://developers.google.com/maps/documentation/places/web-service/place-id
 *   (o desde whitespark.ca/google-review-link-generator que es lo
 *    mismo en bonito).
 *
 * También acepta el formato "alternativo corto" g.page/r/<id>/review
 * que Google ofrece a algunos negocios — lo dejamos como input opcional
 * por si el user lo prefiere.
 */

const PLACEID_RE = /^[A-Za-z0-9_-]{20,}$/;

export function buildGmbReviewUrl(placeId: string): string | null {
  const p = (placeId ?? "").trim();
  if (!p) return null;
  if (!PLACEID_RE.test(p)) return null;
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(p)}`;
}

/**
 * Si el user pega una URL completa (típica de whitespark) en vez del
 * placeId crudo, extraemos el placeId para guardarlo normalizado.
 *
 * Acepta:
 *   https://search.google.com/local/writereview?placeid=ChIJ…
 *   https://www.google.com/maps/place/?q=place_id:ChIJ…
 *   https://whitespark.ca/google-review-link-generator?placeid=ChIJ…
 *   ChIJ…                              (raw)
 */
export function extractPlaceId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (PLACEID_RE.test(s)) return s;
  try {
    const u = new URL(s);
    const fromQuery = u.searchParams.get("placeid") ?? u.searchParams.get("place_id");
    if (fromQuery && PLACEID_RE.test(fromQuery)) return fromQuery;
    // ?q=place_id:ChIJ...
    const q = u.searchParams.get("q") ?? "";
    const m = q.match(/place_id:([A-Za-z0-9_-]{20,})/);
    if (m) return m[1];
  } catch {
    // input no era URL
  }
  return null;
}
