/**
 * Cliente de Google Places API (New) — Text Search + Place Details.
 *
 * Auth: header `X-Goog-Api-Key`. Key configurada en
 * workspace.settings.leads.googleApiKey (cifrada).
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret, maskSecret } from "@/lib/ai/crypto";

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_BASE = "https://places.googleapis.com/v1/places/";

// Campos que pedimos en X-Goog-FieldMask
const TEXT_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.businessStatus",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "nextPageToken"
].join(",");

const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "reviews",
  "editorialSummary",
  "regularOpeningHours"
].join(",");

/** Resuelve la API key + de DÓNDE sale (para diagnóstico). Prioriza la
 *  guardada cifrada en ajustes; si no hay (o no descifra), usa la env.
 *  Hace trim(): un salto de línea o espacio al pegar la clave es causa
 *  típica de "API key not valid". */
async function resolveGoogleApiKey(workspaceId: string): Promise<{ key: string; source: string }> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings: any = ws?.settings ?? {};
  const encrypted: string | undefined = settings?.leads?.googleApiKey;
  if (encrypted) {
    const dec = decryptSecret(encrypted)?.trim();
    if (dec) return { key: dec, source: "Ajustes (/admin/leads/settings)" };
  }
  const env = (process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
  if (env) return { key: env, source: "variable de entorno GOOGLE_PLACES_API_KEY" };
  throw new Error("No hay API key de Google Places. Configúrala en /admin/leads/settings.");
}

export async function getGoogleApiKeyForWorkspace(workspaceId: string): Promise<string> {
  const { key } = await resolveGoogleApiKey(workspaceId);
  return key;
}

export type PlacesResult = {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  province: string | null;
  types: string[];
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  userRatingCount: number;
  priceLevel: number | null;
  businessStatus: string | null;
  gmbUrl: string | null;
  website: string | null;
  phone: string | null;
  internationalPhone: string | null;
  rawData: any;
};

/**
 * Llama a places:searchText. Soporta paginación con nextPageToken
 * (hasta `maxPages`).
 */
export async function placesTextSearch(opts: {
  workspaceId: string;
  query: string; // "keyword en provincia"
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  pageSize?: number;
  maxPages?: number;
  province?: string; // para tag posterior
  languageCode?: string;
  regionCode?: string;
}): Promise<PlacesResult[]> {
  const { key: apiKey, source: keySource } = await resolveGoogleApiKey(opts.workspaceId);
  const results: PlacesResult[] = [];
  let pageToken: string | undefined;
  const maxPages = opts.maxPages ?? 3;
  const pageSize = Math.min(opts.pageSize ?? 20, 20);

  for (let page = 0; page < maxPages; page++) {
    const body: any = {
      textQuery: opts.query,
      languageCode: opts.languageCode ?? "es",
      regionCode: opts.regionCode ?? "ES",
      pageSize
    };
    if (opts.lat != null && opts.lng != null) {
      body.locationBias = {
        circle: { center: { latitude: opts.lat, longitude: opts.lng }, radius: opts.radiusMeters ?? 50000 }
      };
    }
    if (pageToken) body.pageToken = pageToken;

    const resp = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": TEXT_FIELD_MASK
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const txt = await resp.text();
      let msg = `Places ${resp.status}: ${txt.slice(0, 300)}`;
      if (/API_KEY_INVALID|API key not valid/i.test(txt)) {
        msg +=
          `\n[Diagnóstico NV] La clave usada (${maskSecret(apiKey)}) viene de: ${keySource}. ` +
          `Si crees que es correcta, lo más probable es que esa fuente tenga una versión antigua o con un espacio/salto de línea: ` +
          `vuelve a pegarla y guardar en /admin/leads/settings. ` +
          `Comprueba también en Google Cloud que la key tenga habilitada "Places API (New)" y que sus restricciones no bloqueen llamadas de servidor (sin restricción de referrer HTTP).`;
      }
      throw new Error(msg);
    }
    const data = await resp.json();
    const places = Array.isArray(data?.places) ? data.places : [];
    for (const p of places) {
      results.push(mapPlace(p, opts.province));
    }
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
    // Google exige delay para activar el siguiente pageToken
    await new Promise((r) => setTimeout(r, 2000));
  }

  return results;
}

function mapPlace(p: any, province?: string): PlacesResult {
  const types = Array.isArray(p?.types) ? p.types : [];
  const primary = p?.primaryTypeDisplayName?.text ?? p?.primaryType ?? null;
  const provinceFromComponents = extractProvinceFromComponents(p?.addressComponents);
  return {
    placeId: String(p?.id ?? ""),
    name: p?.displayName?.text ?? "",
    formattedAddress: p?.formattedAddress ?? null,
    province: province ?? provinceFromComponents,
    types,
    category: primary,
    latitude: p?.location?.latitude ?? null,
    longitude: p?.location?.longitude ?? null,
    rating: p?.rating != null ? Number(p.rating) : null,
    userRatingCount: Number(p?.userRatingCount ?? 0),
    priceLevel: parsePriceLevel(p?.priceLevel),
    businessStatus: p?.businessStatus ?? null,
    gmbUrl: p?.googleMapsUri ?? null,
    website: p?.websiteUri ?? null,
    phone: p?.nationalPhoneNumber ?? null,
    internationalPhone: p?.internationalPhoneNumber ?? null,
    rawData: p
  };
}

function extractProvinceFromComponents(components: any): string | null {
  if (!Array.isArray(components)) return null;
  for (const c of components) {
    const t = c?.types ?? [];
    if (t.includes("administrative_area_level_2")) return c?.longText ?? c?.shortText ?? null;
  }
  for (const c of components) {
    const t = c?.types ?? [];
    if (t.includes("administrative_area_level_1")) return c?.longText ?? c?.shortText ?? null;
  }
  return null;
}

function parsePriceLevel(v: any): number | null {
  if (v == null) return null;
  // En Places New es "PRICE_LEVEL_INEXPENSIVE" etc.
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const map: Record<string, number> = {
      PRICE_LEVEL_FREE: 0,
      PRICE_LEVEL_INEXPENSIVE: 1,
      PRICE_LEVEL_MODERATE: 2,
      PRICE_LEVEL_EXPENSIVE: 3,
      PRICE_LEVEL_VERY_EXPENSIVE: 4
    };
    if (map[v] !== undefined) return map[v];
  }
  return null;
}

/**
 * Obtiene reviews y horarios de un place (no se usa para el text search
 * inicial; sólo cuando el user activa fetch_details).
 */
export async function placeDetails(opts: {
  workspaceId: string;
  placeId: string;
  languageCode?: string;
}): Promise<{ reviews: any[]; positivePct: number; negativePct: number; neutralPct: number; raw: any }> {
  const apiKey = await getGoogleApiKeyForWorkspace(opts.workspaceId);
  const url = `${PLACES_BASE}${encodeURIComponent(opts.placeId)}?languageCode=${opts.languageCode ?? "es"}`;
  const resp = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK
    }
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Place Details ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = await resp.json();
  const reviews = Array.isArray(data?.reviews) ? data.reviews : [];

  let pos = 0;
  let neg = 0;
  let neu = 0;
  for (const r of reviews) {
    const rating = Number(r?.rating ?? 0);
    if (rating >= 4) pos++;
    else if (rating < 3) neg++;
    else neu++;
  }
  const total = reviews.length || 1;
  return {
    reviews,
    positivePct: Math.round((pos / total) * 1000) / 10,
    negativePct: Math.round((neg / total) * 1000) / 10,
    neutralPct: Math.round((neu / total) * 1000) / 10,
    raw: data
  };
}
