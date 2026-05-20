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

/**
 * Nearby search alrededor de unas coordenadas, con paginación (hasta 3
 * páginas = ~60 resultados). Para el Buscador GMB.
 */
export async function placesNearby(opts: {
  workspaceId: string;
  lat: number;
  lng: number;
  radius: number; // metros
  keyword?: string;
  type?: string;
  maxPages?: number;
}): Promise<MapsPlace[]> {
  const key = await getGmbMapsKey(opts.workspaceId);
  if (!key) throw new MapsKeyMissingError();
  const out: MapsPlace[] = [];
  let pageToken: string | null = null;
  const maxPages = Math.min(opts.maxPages ?? 3, 3);
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      location: `${opts.lat},${opts.lng}`,
      radius: String(Math.round(opts.radius)),
      language: "es",
      key
    });
    if (opts.keyword) params.set("keyword", opts.keyword);
    if (opts.type) params.set("type", opts.type);
    if (pageToken) params.set("pagetoken", pageToken);
    const r = await fetch(`${BASE}/nearbysearch/json?${params.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) break;
    const data = await r.json();
    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      if (page === 0) throw new Error(`Maps: ${data.status}${data.error_message ? ` — ${data.error_message}` : ""}`);
      break;
    }
    for (const res of data.results ?? []) out.push(mapResult(res));
    pageToken = data.next_page_token ?? null;
    if (!pageToken) break;
    await new Promise((res) => setTimeout(res, 2000)); // Google exige espera antes de usar next_page_token
  }
  return out;
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

export type GridCell = { lat: number; lng: number; position: number | null };
export type GridRankResult = {
  cells: GridCell[];
  avgPosition: number;
  foundCount: number;
  top3Count: number;
  cellCount: number;
};

/**
 * Escaneo de ranking por zonas (grid-rank / heatmap). Recorre una rejilla
 * NxN centrada en (lat,lng); en cada celda hace un textsearch del keyword y
 * busca en qué posición aparece el negocio (por placeId o por nombre). Una
 * llamada Maps por celda → cap a 7x7 = 49 para no disparar coste/latencia.
 */
export async function gridRank(opts: {
  workspaceId: string;
  lat: number;
  lng: number;
  keyword: string;
  businessName: string;
  placeId?: string;
  size?: number; // celdas por lado (3-7)
  radiusKm?: number; // radio total del barrido
}): Promise<GridRankResult> {
  const key = await getGmbMapsKey(opts.workspaceId);
  if (!key) throw new MapsKeyMissingError();
  const size = Math.max(3, Math.min(opts.size ?? 5, 7));
  const radiusKm = Math.max(0.5, Math.min(opts.radiusKm ?? 3, 20));
  // Paso entre celdas en grados (aprox: 1º lat ≈ 111km).
  const stepLat = radiusKm / 111 / ((size - 1) / 2 || 1);
  const stepLng = radiusKm / (111 * Math.cos((opts.lat * Math.PI) / 180)) / ((size - 1) / 2 || 1);
  const half = Math.floor(size / 2);
  const wantId = opts.placeId?.trim();
  const wantName = opts.businessName.trim().toLowerCase();

  const cells: GridCell[] = [];
  for (let row = -half; row <= half; row++) {
    for (let col = -half; col <= half; col++) {
      const lat = opts.lat + row * stepLat;
      const lng = opts.lng + col * stepLng;
      let position: number | null = null;
      try {
        const url = `${BASE}/textsearch/json?query=${encodeURIComponent(opts.keyword)}&location=${lat},${lng}&radius=${Math.round(
          (radiusKm * 1000) / size
        )}&language=es&key=${key}`;
        const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
        if (r.ok) {
          const data = await r.json();
          const results: any[] = data.results ?? [];
          const idx = results.findIndex((res) =>
            wantId ? res.place_id === wantId : (res.name ?? "").toLowerCase().includes(wantName)
          );
          if (idx >= 0) position = idx + 1;
        }
      } catch {
        // celda fallida → position null
      }
      cells.push({ lat, lng, position });
      await new Promise((res) => setTimeout(res, 80)); // suaviza rate-limit
    }
  }
  const found = cells.filter((c) => c.position !== null);
  const avgPosition = found.length
    ? Number((found.reduce((s, c) => s + (c.position ?? 0), 0) / found.length).toFixed(1))
    : 0;
  return {
    cells,
    avgPosition,
    foundCount: found.length,
    top3Count: cells.filter((c) => c.position !== null && c.position <= 3).length,
    cellCount: cells.length
  };
}

/** Resuelve coordenadas de un negocio: usa placeId → details, o geocoding por texto. */
export async function resolveCoords(opts: {
  workspaceId: string;
  placeId?: string;
  query?: string;
}): Promise<{ lat: number; lng: number; placeId?: string } | null> {
  if (opts.placeId) {
    const d = await placeDetails({ workspaceId: opts.workspaceId, placeId: opts.placeId });
    if (d?.lat != null && d?.lng != null) return { lat: d.lat, lng: d.lng, placeId: opts.placeId };
  }
  if (opts.query) {
    const res = await placesTextSearch({ workspaceId: opts.workspaceId, query: opts.query, limit: 1 });
    const first = res[0];
    if (first?.lat != null && first?.lng != null) return { lat: first.lat, lng: first.lng, placeId: first.placeId };
  }
  return null;
}

