/**
 * Competencia ordenada por posicionamiento real: busca la palabra clave principal en Google Maps
 * "desde" la provincia del negocio y devuelve los resultados en el orden en que Google los muestra.
 *
 *  - Con SerpApi (Ajustes de GMB Hub): ranking real de Google Maps centrado en la provincia (ll=@lat,lng,9z).
 *  - Sin SerpApi: Places Text Search con sesgo de ubicación al centro de la provincia (orden de relevancia de Google).
 */
import { getGmbMapsKey } from "@/lib/integrations/gmb-hub";
import { MapsKeyMissingError } from "@/lib/integrations/google-maps";
import { getSerpApiKey, SerpApiClient } from "@/lib/integrations/serpapi";

/** Prefijo de código postal → provincia (España). */
const CP_PROVINCE: Record<string, string> = {
  "01": "Álava", "02": "Albacete", "03": "Alicante", "04": "Almería", "05": "Ávila", "06": "Badajoz", "07": "Islas Baleares",
  "08": "Barcelona", "09": "Burgos", "10": "Cáceres", "11": "Cádiz", "12": "Castellón", "13": "Ciudad Real", "14": "Córdoba",
  "15": "A Coruña", "16": "Cuenca", "17": "Girona", "18": "Granada", "19": "Guadalajara", "20": "Gipuzkoa", "21": "Huelva",
  "22": "Huesca", "23": "Jaén", "24": "León", "25": "Lleida", "26": "La Rioja", "27": "Lugo", "28": "Madrid", "29": "Málaga",
  "30": "Murcia", "31": "Navarra", "32": "Ourense", "33": "Asturias", "34": "Palencia", "35": "Las Palmas", "36": "Pontevedra",
  "37": "Salamanca", "38": "Santa Cruz de Tenerife", "39": "Cantabria", "40": "Segovia", "41": "Sevilla", "42": "Soria",
  "43": "Tarragona", "44": "Teruel", "45": "Toledo", "46": "Valencia", "47": "Valladolid", "48": "Bizkaia", "49": "Zamora",
  "50": "Zaragoza", "51": "Ceuta", "52": "Melilla"
};

const COUNTRY_RE = /^(españa|spain|espanya|espainia)$/i;

export function provinceFromAddress(address: string): string {
  const a = (address || "").trim();
  if (!a) return "";
  const cp = a.match(/\b(\d{5})\b/);
  if (cp && CP_PROVINCE[cp[1].slice(0, 2)]) return CP_PROVINCE[cp[1].slice(0, 2)];
  const parts = a
    .split(",")
    .map((s) => s.replace(/\d+/g, "").trim())
    .filter((s) => s && !COUNTRY_RE.test(s));
  return parts[parts.length - 1] ?? "";
}

export function normName(s: string) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type RankedPlace = {
  position: number;
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  placeId: string;
  category: string;
  isYou: boolean;
};

export type RankingResult = {
  keyword: string;
  province: string;
  source: "serpapi" | "places";
  center: { lat: number; lng: number } | null;
  yourPosition: number | null;
  results: RankedPlace[];
};

const MAPS = "https://maps.googleapis.com/maps/api/place";

async function provinceCenter(key: string, province: string): Promise<{ lat: number; lng: number } | null> {
  if (!province) return null;
  const q = `provincia de ${province}, España`;
  const r = await fetch(`${MAPS}/textsearch/json?query=${encodeURIComponent(q)}&language=es&key=${key}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  }).catch(() => null);
  const d = r && r.ok ? await r.json().catch(() => null) : null;
  const loc = d?.results?.[0]?.geometry?.location;
  return loc && typeof loc.lat === "number" ? { lat: loc.lat, lng: loc.lng } : null;
}

function isSame(p: { placeId: string; name: string }, you: { placeId: string; name: string }) {
  const a = normName(p.name);
  const b = normName(you.name);
  if (you.placeId && p.placeId) return p.placeId === you.placeId || (!!a && a === b);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

async function viaSerpApi(serpKey: string, keyword: string, center: { lat: number; lng: number }, pages: number) {
  const client = new SerpApiClient(serpKey, { cacheDays: 1 });
  const out: Omit<RankedPlace, "position" | "isYou">[] = [];
  for (let page = 0; page < pages; page++) {
    const d = await client.request({
      engine: "google_maps",
      type: "search",
      q: keyword,
      ll: `@${center.lat.toFixed(5)},${center.lng.toFixed(5)},9z`,
      hl: "es",
      gl: "es",
      start: page * 20
    });
    const list: any[] = d?.local_results ?? [];
    for (const r of list) {
      out.push({
        name: r.title ?? "",
        address: r.address ?? "",
        rating: typeof r.rating === "number" ? r.rating : null,
        reviewCount: Number(r.reviews ?? 0) || 0,
        placeId: r.place_id ?? "",
        category: r.type ?? (Array.isArray(r.types) ? r.types[0] : "") ?? ""
      });
    }
    if (list.length < 20) break;
  }
  return out;
}

async function viaPlaces(mapsKey: string, keyword: string, center: { lat: number; lng: number } | null, province: string, pages: number) {
  const out: Omit<RankedPlace, "position" | "isYou">[] = [];
  const base = center
    ? `${MAPS}/textsearch/json?query=${encodeURIComponent(keyword)}&location=${center.lat},${center.lng}&radius=50000&language=es&region=es&key=${mapsKey}`
    : `${MAPS}/textsearch/json?query=${encodeURIComponent([keyword, province].filter(Boolean).join(" en "))}&language=es&region=es&key=${mapsKey}`;
  let token: string | undefined;
  for (let page = 0; page < pages; page++) {
    if (page > 0) {
      if (!token) break;
      await new Promise((r) => setTimeout(r, 2100)); // el next_page_token tarda ~2s en activarse
    }
    const url = page === 0 ? base : `${MAPS}/textsearch/json?pagetoken=${encodeURIComponent(token!)}&key=${mapsKey}`;
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Maps ${r.status}`);
    const d = await r.json();
    if (d.status && d.status !== "OK" && d.status !== "ZERO_RESULTS") {
      if (page > 0) break;
      throw new Error(`Maps: ${d.status}${d.error_message ? ` — ${d.error_message}` : ""}`);
    }
    for (const x of d.results ?? []) {
      out.push({
        name: x.name ?? "",
        address: x.formatted_address ?? "",
        rating: typeof x.rating === "number" ? x.rating : null,
        reviewCount: Number(x.user_ratings_total ?? 0) || 0,
        placeId: x.place_id ?? "",
        category: Array.isArray(x.types) ? String(x.types[0] ?? "").replace(/_/g, " ") : ""
      });
    }
    token = d.next_page_token;
  }
  return out;
}

export async function rankCompetitors(opts: {
  workspaceId: string;
  keyword: string;
  province: string;
  you: { name: string; placeId: string; lat?: number | null; lng?: number | null };
  pages?: number;
}): Promise<RankingResult> {
  const mapsKey = await getGmbMapsKey(opts.workspaceId);
  const serpKey = await getSerpApiKey(opts.workspaceId).catch(() => null);
  if (!mapsKey && !serpKey) throw new MapsKeyMissingError();
  const pages = Math.max(1, Math.min(opts.pages ?? 3, 3));

  let center = mapsKey ? await provinceCenter(mapsKey, opts.province) : null;
  if (!center && opts.you.lat != null && opts.you.lng != null) center = { lat: opts.you.lat, lng: opts.you.lng };

  let source: RankingResult["source"] = "places";
  let raw: Omit<RankedPlace, "position" | "isYou">[] = [];
  if (serpKey && center) {
    try {
      raw = await viaSerpApi(serpKey, opts.keyword, center, Math.min(pages, 2));
      source = "serpapi";
    } catch (e) {
      if (!mapsKey) throw e;
    }
  }
  if (source === "places") {
    if (!mapsKey) throw new MapsKeyMissingError();
    raw = await viaPlaces(mapsKey, opts.keyword, center, opts.province, pages);
  }

  const seen = new Set<string>();
  const results: RankedPlace[] = [];
  for (const r of raw) {
    const k = r.placeId || normName(r.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    results.push({ ...r, position: results.length + 1, isYou: isSame(r, opts.you) });
  }
  // Solo una fila puede ser "tú": la primera coincidencia.
  let found = false;
  for (const r of results) {
    if (r.isYou && found) r.isYou = false;
    if (r.isYou) found = true;
  }
  const mine = results.find((r) => r.isYou);
  return { keyword: opts.keyword, province: opts.province, source, center, yourPosition: mine?.position ?? null, results };
}
