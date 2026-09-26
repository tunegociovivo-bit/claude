/**
 * Detector de reseñas falsas — tipos y normalización (lógica pura, sin BD ni red).
 */

export type Place = {
  title: string;
  address: string;
  rating: number | null;
  reviews: number | null;
  type: string;
  dataId: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
  thumbnail: string;
  mapsUrl: string;
};

export type ReviewUser = {
  name: string;
  contributorId: string;
  link: string;
  thumbnail: string;
  localGuide: boolean;
  reviews: number;
  photos: number;
};

export type Review = {
  reviewId: string;
  rating: number;
  ts: number; // epoch segundos (0 = desconocida)
  date: string; // YYYY-MM-DD
  text: string;
  photos: number;
  link: string;
  user: ReviewUser;
};

export type ContributorReview = {
  placeTitle: string;
  placeType: string;
  dataId: string;
  lat: number | null;
  lng: number | null;
  rating: number;
  ts: number;
  date: string;
  text: string;
  link: string;
};

export type Contributor = {
  name: string;
  thumbnail: string;
  localGuide: boolean;
  level: number;
  totalReviews: number;
  totalPhotos: number;
  reviews: ContributorReview[];
};

export type AnalysisParams = {
  /** manual = competidores indicados; auto = descubre los negocios beneficiados; policy = sólo revisión de contenido. */
  mode?: "manual" | "auto" | "policy";
  /** Revisar el contenido de cada reseña negativa frente a las políticas de Google (reglas + IA). */
  policy?: boolean;
  /** Buscar positivas sospechosas en la competencia (picos, cuentas nuevas…). Por defecto sí. */
  compFakes?: boolean;
  /** auto: nº mínimo de autores de negativas que valoraron bien el mismo negocio. */
  minOverlap?: number;
  client: Place;
  competitors: Place[];
  negThreshold: number; // 1..3
  posThreshold: number; // 4..5
  windowDays: number;
  dateFrom: string; // YYYY-MM-DD o ""
  deep: boolean;
  ai: boolean;
  maxClientPages: number;
  maxCompPages: number;
  maxDeep: number;
};

export const DAY = 86_400;

/* ───────────────────────── Fechas ───────────────────────── */

const WORDS: Record<string, number> = {
  un: 1, una: 1, a: 1, an: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3,
  cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6
};
const UNITS: [string, number][] = [
  ["minuto", 60], ["minute", 60], ["hora", 3600], ["hour", 3600],
  ["día", DAY], ["dia", DAY], ["day", DAY], ["semana", 7 * DAY], ["week", 7 * DAY],
  ["mes", 2_629_800], ["month", 2_629_800], ["año", 31_557_600], ["ano", 31_557_600], ["year", 31_557_600]
];

/** "hace 2 semanas", "a month ago", "Editado: hace 3 días" → epoch s (aprox). */
export function relativeToTs(s: string, now = Math.floor(Date.now() / 1000)): number {
  let t = (s ?? "").toLowerCase().trim();
  if (!t) return 0;
  t = t.replace(/^(editado|edited|modificado)\s*:?\s*/u, "").replace("hace ", "").replace(" ago", "").replace("about ", "");
  const m = t.match(/^(\d+|[a-záéíóúñ]+)\s+([a-záéíóúñ]+)/u);
  if (!m) return 0;
  const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : WORDS[m[1]] ?? 0;
  if (!n) return 0;
  for (const [u, secs] of UNITS) if (m[2].startsWith(u)) return now - n * secs;
  return 0;
}

export function toTs(iso?: string, relative?: string, now?: number): number {
  if (iso) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return relativeToTs(relative ?? "", now);
}

export function tsDate(ts: number): string {
  return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "";
}

/* ───────────────────────── Normalización SerpApi ───────────────────────── */

export function contributorIdFrom(user: any): string {
  if (user?.contributor_id) return String(user.contributor_id);
  const m = String(user?.link ?? "").match(/\/contrib\/(\d+)/);
  return m ? m[1] : "";
}

export function normalizeReview(r: any, now?: number): Review {
  const u = r?.user ?? {};
  const ts = toTs(r?.iso_date, r?.date, now);
  return {
    reviewId: String(r?.review_id ?? ""),
    rating: Number(r?.rating ?? 0),
    ts,
    date: tsDate(ts),
    text: String(r?.extracted_snippet?.original ?? r?.snippet ?? ""),
    photos: Array.isArray(r?.images) ? r.images.length : 0,
    link: String(r?.link ?? ""),
    user: {
      name: String(u.name ?? ""),
      contributorId: contributorIdFrom(u),
      link: String(u.link ?? ""),
      thumbnail: String(u.thumbnail ?? ""),
      localGuide: !!u.local_guide,
      reviews: Number(u.reviews ?? 0),
      photos: Number(u.photos ?? 0)
    }
  };
}

export function normalizeContributor(d: any, now?: number): Contributor {
  const c = d?.contributor ?? {};
  const contrib = c.contributions ?? {};
  const reviews: ContributorReview[] = (d?.reviews ?? []).map((r: any) => {
    const pi = r?.place_info ?? {};
    const ts = toTs(r?.iso_date, r?.date, now);
    return {
      placeTitle: String(pi.title ?? ""),
      placeType: String(pi.type ?? ""),
      dataId: String(pi.data_id ?? ""),
      lat: pi.gps_coordinates?.latitude != null ? Number(pi.gps_coordinates.latitude) : null,
      lng: pi.gps_coordinates?.longitude != null ? Number(pi.gps_coordinates.longitude) : null,
      rating: Number(r?.rating ?? 0),
      ts,
      date: tsDate(ts),
      text: String(r?.snippet ?? ""),
      link: String(r?.link ?? "")
    };
  });
  return {
    name: String(c.name ?? ""),
    thumbnail: String(c.thumbnail ?? ""),
    localGuide: !!c.local_guide,
    level: Number(c.level ?? 0),
    totalReviews: Number(contrib.reviews ?? 0) || reviews.length,
    totalPhotos: Number(contrib.photos ?? 0),
    reviews
  };
}

export function nextToken(d: any): string {
  const p = d?.serpapi_pagination ?? {};
  if (p.next_page_token) return String(p.next_page_token);
  if (p.next) {
    try {
      return new URL(p.next).searchParams.get("next_page_token") ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

export function placeFrom(p: any): Place {
  const lat = p?.gps_coordinates?.latitude ?? p?.lat ?? null;
  const lng = p?.gps_coordinates?.longitude ?? p?.lng ?? null;
  let type = p?.type ?? "";
  if (Array.isArray(type)) type = type.join(", ");
  if (!type && Array.isArray(p?.types)) type = p.types[0] ?? "";
  const place: Place = {
    title: String(p?.title ?? ""),
    address: String(p?.address ?? ""),
    rating: p?.rating != null ? Number(p.rating) : null,
    reviews: p?.reviews != null ? Number(p.reviews) : null,
    type: String(type),
    dataId: String(p?.data_id ?? p?.dataId ?? ""),
    placeId: String(p?.place_id ?? p?.placeId ?? ""),
    lat: lat != null ? Number(lat) : null,
    lng: lng != null ? Number(lng) : null,
    thumbnail: String(p?.thumbnail ?? ""),
    mapsUrl: ""
  };
  place.mapsUrl = place.placeId
    ? `https://www.google.com/maps/place/?q=place_id:${place.placeId}`
    : `https://www.google.com/maps/search/${encodeURIComponent(`${place.title} ${place.address}`.trim())}`;
  return place;
}

export function idParam(p: Place): { data_id?: string; place_id?: string } {
  return p.dataId ? { data_id: p.dataId } : { place_id: p.placeId };
}

/* ───────────────────────── Parseo de entrada ───────────────────────── */

export type ParsedInput = { dataId: string; placeId: string; name: string; lat: number | null; lng: number | null };

/** Extrae data_id / place_id / nombre / coordenadas de una URL o texto. */
export function parsePlaceInput(s: string): ParsedInput {
  const out: ParsedInput = { dataId: "", placeId: "", name: "", lat: null, lng: null };
  let d = s;
  try {
    d = decodeURIComponent(s);
  } catch {
    /* noop */
  }
  const di = d.match(/(0x[0-9a-f]{6,}:0x[0-9a-f]{6,})/i);
  if (di) out.dataId = di[1].toLowerCase();
  const pi = d.match(/(?:place_id[:=]|query_place_id=)([A-Za-z0-9_-]{20,})/);
  if (pi) out.placeId = pi[1];
  else if (/^(ChIJ|GhIJ|EhI)[A-Za-z0-9_-]{15,}$/.test(d.trim())) out.placeId = d.trim();
  const ll = d.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? d.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (ll) {
    out.lat = parseFloat(ll[1]);
    out.lng = parseFloat(ll[2]);
  }
  const nm = d.match(/\/maps\/place\/([^/@?]+)/);
  if (nm) out.name = nm[1].replace(/\+/g, " ").trim();
  else {
    const q = d.match(/[?&]q=([^&]+)/);
    if (q && !/^https?:\/\//.test(q[1])) out.name = q[1].replace(/\+/g, " ").trim();
  }
  return out;
}
