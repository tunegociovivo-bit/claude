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
  "places.photos",
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
/** Todas las claves candidatas, EN ORDEN de preferencia y sin duplicados:
 *  primero la guardada cifrada en Ajustes, luego la variable de entorno.
 *  Devolver TODAS permite que, si la primera es inválida, se reintente con la
 *  siguiente (p. ej. la de Ajustes caducó pero la env sigue siendo buena). */
async function resolveGoogleApiKeyCandidates(workspaceId: string): Promise<{ key: string; source: string }[]> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings: any = ws?.settings ?? {};
  const out: { key: string; source: string }[] = [];
  const encrypted: string | undefined = settings?.leads?.googleApiKey;
  if (encrypted) {
    const dec = decryptSecret(encrypted)?.trim();
    if (dec) out.push({ key: dec, source: "Ajustes (/admin/leads/settings)" });
  }
  const env = (process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
  if (env && !out.some((c) => c.key === env)) {
    out.push({ key: env, source: "variable de entorno GOOGLE_PLACES_API_KEY" });
  }
  if (out.length === 0) {
    throw new Error("No hay API key de Google Places. Configúrala en /admin/leads/settings.");
  }
  return out;
}

async function resolveGoogleApiKey(workspaceId: string): Promise<{ key: string; source: string }> {
  return (await resolveGoogleApiKeyCandidates(workspaceId))[0];
}

export async function getGoogleApiKeyForWorkspace(workspaceId: string): Promise<string> {
  const { key } = await resolveGoogleApiKey(workspaceId);
  return key;
}

const KEY_INVALID_RE = /API_KEY_INVALID|API key not valid/i;

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
  const candidates = await resolveGoogleApiKeyCandidates(opts.workspaceId);
  let keyIdx = 0;
  let apiKey = candidates[keyIdx].key;
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
      // Si la clave actual es inválida y hay otra candidata sin probar
      // (p. ej. Ajustes falla pero la env es buena), reintenta con la siguiente.
      if (KEY_INVALID_RE.test(txt) && keyIdx < candidates.length - 1) {
        keyIdx++;
        apiKey = candidates[keyIdx].key;
        page--; // reintenta esta misma página con la nueva clave
        continue;
      }
      let msg = `Places ${resp.status}: ${txt.slice(0, 300)}`;
      if (KEY_INVALID_RE.test(txt)) {
        const tried = candidates.map((c) => `${maskSecret(c.key)} (${c.source})`).join(" · ");
        msg +=
          `\n[Diagnóstico NV] Ninguna API key de Google Places válida. Probadas: ${tried}. ` +
          `Lo más probable: la clave de Ajustes tiene un espacio/salto de línea o caducó — ` +
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
 * Descarga la primera foto de un place (Places Photo Media) y la devuelve como
 * data URL base64, para incrustarla en el mockup (Satori) sin exponer la API
 * key. `photoName` es el campo `places.photos[].name`. Best-effort: null si
 * falla o no hay foto.
 */
export async function getPlacePhotoDataUrl(opts: {
  workspaceId: string;
  photoName: string;
  maxPx?: number;
}): Promise<string | null> {
  if (!opts.photoName) return null;
  try {
    const px = opts.maxPx ?? 600;
    const candidates = await resolveGoogleApiKeyCandidates(opts.workspaceId);
    // Prueba cada clave (Ajustes → env) hasta que una baje la foto.
    let resp: Response | null = null;
    for (const c of candidates) {
      const url = `${"https://places.googleapis.com/v1/"}${opts.photoName}/media?maxWidthPx=${px}&maxHeightPx=${px}&key=${c.key}`;
      const r = await fetch(url); // sigue el redirect a la imagen real
      if (r.ok) {
        resp = r;
        break;
      }
    }
    if (!resp || !resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const raw = Buffer.from(await resp.arrayBuffer());
    if (raw.length === 0 || raw.length > 8_000_000) return null; // sanidad

    // IMPORTANTE: Satori (next/og) sólo decodifica PNG/JPEG/GIF. Google Places
    // suele servir WebP/AVIF, que hacían CRASHEAR el render del mockup (502).
    // Re-codificamos SIEMPRE a JPEG con sharp para garantizar un formato que
    // Satori entienda y, de paso, acotar tamaño.
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(raw)
      .resize(px, px, { fit: "cover", position: "centre" })
      .jpeg({ quality: 80 })
      .toBuffer();
    if (jpeg.length === 0) return null;
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
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
