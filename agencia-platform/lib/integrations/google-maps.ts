/**
 * Google Maps Places API (Web Service) para las features de SEO local de
 * GMB Hub (competencia, ranking, etc.). Usa la Maps key del workspace
 * (settings.integrations.gmb.mapsKeyEnc → env GOOGLE_MAPS_API_KEY).
 */
import { getGmbMapsKey } from "@/lib/integrations/gmb-hub";

const BASE = "https://maps.googleapis.com/maps/api/place";

export class MapsKeyMissingError extends Error {
  constructor() {
    super("Falta la Google Maps API key. Configúrala en GMB Hub → ajustes.");
  }
}

export type MapsPlace = {
  placeId: string;
  name: string;
  address: string;
  rating: number;
  reviewCount: number;
  lat: number | null;
  lng: number | null;
};

function mapResult(r: any): MapsPlace {
  return {
    placeId: r.place_id,
    name: r.name ?? "",
    address: r.formatted_address ?? r.vicinity ?? "",
    rating: Number(r.rating ?? 0),
    reviewCount: Number(r.user_ratings_total ?? 0),
    lat: r.geometry?.location?.lat ?? null,
    lng: r.geometry?.location?.lng ?? null
  };
}

/** Búsqueda por texto (textsearch). Devuelve hasta ~20 resultados. */
export async function placesTextSearch(opts: {
  workspaceId: string;
  query: string;
  limit?: number;
}): Promise<MapsPlace[]> {
  const key = await getGmbMapsKey(opts.workspaceId);
  if (!key) throw new MapsKeyMissingError();
  const url = `${BASE}/textsearch/json?query=${encodeURIComponent(opts.query)}&language=es&key=${key}`;
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Maps ${r.status}`);
  const data = await r.json();
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Maps: ${data.status}${data.error_message ? ` — ${data.error_message}` : ""}`);
  }
  return (data.results ?? []).slice(0, opts.limit ?? 20).map(mapResult);
}

/** Detalles de un place_id (geometría, web, teléfono, dirección). */
export async function placeDetails(opts: {
  workspaceId: string;
  placeId: string;
}): Promise<(MapsPlace & { website: string; phone: string }) | null> {
  const key = await getGmbMapsKey(opts.workspaceId);
  if (!key) throw new MapsKeyMissingError();
  const fields = "place_id,name,geometry,formatted_address,formatted_phone_number,website,rating,user_ratings_total";
  const url = `${BASE}/details/json?place_id=${encodeURIComponent(opts.placeId)}&fields=${fields}&language=es&key=${key}`;
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Maps ${r.status}`);
  const data = await r.json();
  if (!data.result) return null;
  const p = mapResult(data.result);
  return { ...p, website: data.result.website ?? "", phone: data.result.formatted_phone_number ?? "" };
}
