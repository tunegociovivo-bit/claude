/**
 * Detector de reseñas falsas — motor de puntuación (determinista y trazable).
 * Cada punto de riesgo lleva la evidencia que lo justifica, para que el informe sea
 * defendible ante el cliente y útil al denunciar reseñas a Google.
 */
import { DAY, tsDate, type AnalysisParams, type Contributor, type ContributorReview, type Place, type Review } from "./core";

export const LEVEL_HIGH = 60;
export const LEVEL_MEDIUM = 35;

export type Level = "alto" | "medio" | "bajo";

export type Signal = { code: string; points: number; label: string; detail: string };

export type EvidenceReview = {
  comp?: number;
  rating: number;
  date: string;
  ts: number;
  text: string;
  link: string;
  title?: string;
  reviewId?: string;
  photos?: number;
};

export type ProfileFeatures = {
  name: string;
  thumbnail: string;
  localGuide: boolean;
  level: number;
  totalReviews: number;
  totalPhotos: number;
  fetched: number;
  avgRating: number | null;
  extremePct: number | null;
  firstTs: number;
  burst: number;
  medianKm: number | null;
  nearPct: number | null;
  compHits: EvidenceReview[];
  clientHits: EvidenceReview[];
  sectorNeg: { title: string; rating: number; date: string; link: string }[];
  sectorNegN: number;
  recent: { title: string; rating: number; date: string; type: string }[];
};

export type Author = {
  cid: string;
  name: string;
  link: string;
  thumbnail: string;
  localGuide: boolean;
  totalReviews: number;
  score: number;
  level: Level;
  crossPos: number;
  gapDays: number | null;
  signals: Signal[];
  clientReviews: EvidenceReview[];
  compReviews: EvidenceReview[];
  profile: null | {
    avgRating: number | null;
    extremePct: number | null;
    fetched: number;
    medianKm: number | null;
    first: string;
    sectorNeg: ProfileFeatures["sectorNeg"];
    sectorNegN: number;
    recent: ProfileFeatures["recent"];
    level: number;
  };
};

/** Reseña positiva (≥ umbral) de un autor de negativas a otro negocio distinto del cliente. */
export type PositiveElsewhere = {
  dataId: string;
  title: string;
  type: string;
  lat: number | null;
  lng: number | null;
  rating: number;
  ts: number;
  date: string;
  text: string;
  link: string;
};

export type DiscoveryCandidate = {
  title: string;
  dataId: string;
  type: string;
  lat: number | null;
  lng: number | null;
  km: number | null;
  sameSector: boolean;
  count: number;
  fastCount: number;
  score: number;
  selected: boolean;
  reviewers: { cid: string; name: string; rating: number; date: string; negDate: string; gapDays: number | null }[];
};

export type Discovery = {
  mode: "manual" | "auto";
  /** history = historial de cada perfil (SerpApi); sweep = barrido de negocios cercanos del sector (Serper). */
  method?: "history" | "sweep";
  minOverlap: number;
  profilesScanned: number;
  candidates: DiscoveryCandidate[];
  sweptPlaces?: { title: string; reviewsRead: number }[];
};

export type SimilarPair = { a: string; b: string; sim: number; aName: string; bName: string; aText: string; bText: string };

export type AnalysisResults = {
  generatedAt: string;
  client: Place;
  competitors: Place[];
  params: { negThreshold: number; posThreshold: number; windowDays: number; dateFrom: string; deep: boolean };
  stats: {
    clientNeg: number;
    authors: number;
    authorsMatched: number;
    authorsCrossPos: number;
    high: number;
    medium: number;
    low: number;
    profilesDeep: number;
    compFetched: number[];
    similarPairs: number;
    suspectNegReviews: number;
  };
  impact: { client: null | { current: number; without: number; removed: number }; competitors: Record<number, { current: number; without: number; removed: number }> };
  authors: Author[];
  similar: SimilarPair[];
  timeline: Record<string, { neg: number; suspect: number; compPos: number }>;
  findings: string[];
  warnings?: string[];
  aiSummary?: string;
  discovery?: Discovery;
};

/* ───────────────────────── utilidades ───────────────────────── */

export function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function km(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function trigrams(s: string): Set<string> {
  const t = `  ${norm(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((x) => {
    if (tb.has(x)) inter++;
  });
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

/** ¿Esta reseña del historial de un autor es de esta ficha? */
export function samePlace(r: { dataId?: string; placeTitle?: string; lat?: number | null; lng?: number | null }, p: Place): boolean {
  if (r.dataId && p.dataId) return r.dataId.toLowerCase() === p.dataId.toLowerCase();
  const a = norm(r.placeTitle ?? "");
  if (!a || a !== norm(p.title)) return false;
  if (r.lat != null && r.lng != null && p.lat != null && p.lng != null) return km(r.lat, r.lng, p.lat, p.lng) < 1.5;
  return true;
}

const STOP = new Set(["de", "del", "la", "el", "y", "en", "tienda", "servicio", "centro", "shop", "store", "service"]);
export function sameSector(a: string, b: string): boolean {
  return typeMatch(a, b);
}

function typeMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wb = new Set(nb.split(" ").filter((w) => !STOP.has(w)));
  return na.split(" ").some((w) => !STOP.has(w) && w.length > 4 && wb.has(w));
}

function short(s: string, n = 400): string {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

const fmt = (n: number, d = 1) => n.toFixed(d).replace(".", ",");

/* ───────────────────────── perfil de autor ───────────────────────── */

function compact(r: ContributorReview): EvidenceReview {
  return { rating: r.rating, date: r.date, ts: r.ts, text: short(r.text), link: r.link, title: r.placeTitle };
}

export function profileFeatures(contrib: Contributor, client: Place, comps: Place[], negTs: number[]): ProfileFeatures {
  const reviews = contrib.reviews;
  const n = reviews.length;
  const compHits: EvidenceReview[] = [];
  const clientHits: EvidenceReview[] = [];
  const sector: { title: string; rating: number; date: string; link: string }[] = [];
  let extremes = 0;
  let sum = 0;
  const dists: number[] = [];
  const dates: number[] = [];

  for (const r of reviews) {
    sum += r.rating;
    if (r.rating <= 1 || r.rating >= 5) extremes++;
    if (r.ts) dates.push(r.ts);
    if (r.lat != null && r.lng != null && client.lat != null && client.lng != null) dists.push(km(r.lat, r.lng, client.lat, client.lng));
    if (samePlace(r, client)) {
      clientHits.push(compact(r));
      continue;
    }
    const ci = comps.findIndex((c) => samePlace(r, c));
    if (ci >= 0) {
      compHits.push({ comp: ci, ...compact(r) });
      continue;
    }
    if (typeMatch(r.placeType, client.type)) sector.push({ title: r.placeTitle, rating: r.rating, date: r.date, link: r.link });
  }

  let burst = 0;
  for (const t of negTs) {
    if (!t) continue;
    burst = Math.max(burst, dates.filter((d) => Math.abs(d - t) <= 1.5 * DAY).length);
  }

  dists.sort((a, b) => a - b);
  const median = dists.length ? dists[Math.floor(dists.length / 2)] : null;
  const near = dists.length ? dists.filter((d) => d <= 30).length / dists.length : null;
  const sectorNeg = sector.filter((s) => s.rating <= 2);
  const recent = [...reviews].sort((a, b) => b.ts - a.ts).slice(0, 12);

  return {
    name: contrib.name,
    thumbnail: contrib.thumbnail,
    localGuide: contrib.localGuide,
    level: contrib.level,
    totalReviews: Math.max(contrib.totalReviews, n),
    totalPhotos: contrib.totalPhotos,
    fetched: n,
    avgRating: n ? Math.round((sum / n) * 100) / 100 : null,
    extremePct: n ? Math.round((extremes / n) * 100) / 100 : null,
    firstTs: dates.length ? Math.min(...dates) : 0,
    burst,
    medianKm: median != null ? Math.round(median * 10) / 10 : null,
    nearPct: near != null ? Math.round(near * 100) / 100 : null,
    compHits,
    clientHits,
    sectorNeg: sectorNeg.slice(0, 8),
    sectorNegN: sectorNeg.length,
    recent: recent.map((r) => ({ title: r.placeTitle, rating: r.rating, date: r.date, type: r.placeType }))
  };
}

/** Reseñas positivas de un autor a negocios distintos del cliente (se guardan compactas en el estado). */
export function positivesElsewhere(contrib: Contributor, client: Place, posTh: number): PositiveElsewhere[] {
  return contrib.reviews
    .filter((r) => r.rating >= posTh && !samePlace(r, client) && (r.dataId || r.placeTitle))
    .map((r) => ({
      dataId: r.dataId, title: r.placeTitle, type: r.placeType, lat: r.lat, lng: r.lng,
      rating: r.rating, ts: r.ts, date: r.date, text: short(r.text, 300), link: r.link
    }));
}

const placeKey = (x: { dataId: string; title: string }) => (x.dataId ? x.dataId.toLowerCase() : `t:${norm(x.title)}`);

/**
 * Descubre negocios a los que VARIOS autores de reseñas negativas al cliente han dado reseñas
 * positivas. Un negocio del mismo sector y cercano con muchos autores en común es el candidato
 * típico a competidor que se beneficia (o encarga) las reseñas.
 */
export function discoverBeneficiaries(
  client: Place,
  clientNeg: Review[],
  positives: Record<string, PositiveElsewhere[]>,
  opts: { minOverlap: number; windowDays: number; maxSelected?: number; mode: "manual" | "auto"; exclude?: Place[] }
): Discovery {
  const names = new Map<string, string>();
  const negTsBy = new Map<string, number[]>();
  for (const r of clientNeg) {
    if (!r.user.contributorId) continue;
    names.set(r.user.contributorId, r.user.name);
    negTsBy.set(r.user.contributorId, [...(negTsBy.get(r.user.contributorId) ?? []), r.ts]);
  }
  const excluded = new Set((opts.exclude ?? []).map((p) => placeKey({ dataId: p.dataId, title: p.title })));

  const byPlace = new Map<string, DiscoveryCandidate>();
  for (const [cid, list] of Object.entries(positives)) {
    const seen = new Set<string>();
    for (const p of list) {
      const k = placeKey(p);
      if (seen.has(k) || excluded.has(k)) continue; // un autor cuenta una vez por negocio
      seen.add(k);
      const c =
        byPlace.get(k) ??
        {
          title: p.title, dataId: p.dataId, type: p.type, lat: p.lat, lng: p.lng,
          km: p.lat != null && p.lng != null && client.lat != null && client.lng != null ? Math.round(km(p.lat, p.lng, client.lat, client.lng) * 10) / 10 : null,
          sameSector: typeMatch(p.type, client.type),
          count: 0, fastCount: 0, score: 0, selected: false, reviewers: []
        };
      const negs = (negTsBy.get(cid) ?? []).filter(Boolean);
      const gap = negs.length && p.ts ? Math.min(...negs.map((t) => Math.abs(t - p.ts) / DAY)) : null;
      c.reviewers.push({ cid, name: names.get(cid) ?? "", rating: p.rating, date: p.date, negDate: negs[0] ? tsDate(negs[0]) : "", gapDays: gap != null ? Math.round(gap * 10) / 10 : null });
      c.count++;
      if (gap != null && gap <= opts.windowDays) c.fastCount++;
      byPlace.set(k, c);
    }
  }

  const candidates = [...byPlace.values()]
    .filter((c) => c.count >= opts.minOverlap)
    .map((c) => ({ ...c, score: c.count * 10 + (c.sameSector ? 20 : 0) + (c.km != null && c.km <= 30 ? 5 : 0) + c.fastCount * 5 }))
    .sort((a, b) => b.score - a.score || b.count - a.count);

  if (opts.mode === "auto") {
    // Prioriza negocios del mismo sector; si no hay, sólo los que tienen un solapamiento claro (≥3 autores).
    const pool = candidates.filter((c) => c.sameSector);
    const pick = (pool.length ? pool : candidates.filter((c) => c.count >= Math.max(3, opts.minOverlap))).slice(0, opts.maxSelected ?? 5);
    const keys = new Set(pick.map(placeKey));
    for (const c of candidates) c.selected = keys.has(placeKey(c));
  }

  return { mode: opts.mode, method: "history", minOverlap: opts.minOverlap, profilesScanned: Object.keys(positives).length, candidates: candidates.slice(0, 25) };
}

/** Hallazgos del descubrimiento de negocios beneficiados (para el resumen del informe). */
export function discoveryFindings(d: Discovery): string[] {
  const top = d.candidates.slice(0, 3);
  if (!d.candidates.length) {
    if (d.mode !== "auto") return [];
    return d.method === "sweep"
      ? [`Se han revisado ${d.sweptPlaces?.length ?? 0} negocios del mismo sector cercanos al cliente y ninguno acumula ${d.minOverlap} o más valoraciones positivas de autores de negativas al cliente.`]
      : [`Se ha revisado el historial de ${d.profilesScanned} perfiles y ningún negocio acumula ${d.minOverlap} o más valoraciones positivas de autores de negativas al cliente.`];
  }
  const f: string[] = [];
  const desc = (c: DiscoveryCandidate) =>
    `${c.title} (${c.count} perfiles en común${c.sameSector ? ", mismo sector" : ""}${c.km != null ? `, a ${c.km.toString().replace(".", ",")} km` : ""})`;
  if (d.mode === "auto") {
    const sel = d.candidates.filter((c) => c.selected);
    f.push(
      sel.length
        ? `Detección automática: ${sel.length === 1 ? "el negocio" : "los negocios"} ${sel.map(desc).join("; ")} ${sel.length === 1 ? "recibe" : "reciben"} valoraciones positivas de varios de los perfiles que puntuaron negativamente al cliente.`
        : `Detección automática: hay negocios con autores en común (${top.map(desc).join("; ")}), pero ninguno del mismo sector con un solapamiento claro.`
    );
  } else {
    f.push(`Además de la competencia indicada, estos negocios reciben positivas de varios autores de negativas al cliente: ${top.map(desc).join("; ")}.`);
  }
  return f;
}

/** Asigna las positivas de cada perfil a los competidores (tras el descubrimiento automático). */
export function attachCompHits(profiles: Record<string, ProfileFeatures>, positives: Record<string, PositiveElsewhere[]>, comps: Place[]) {
  for (const [cid, prof] of Object.entries(profiles)) {
    const hits: EvidenceReview[] = [];
    for (const p of positives[cid] ?? []) {
      const ci = comps.findIndex((c) => samePlace({ dataId: p.dataId, placeTitle: p.title, lat: p.lat, lng: p.lng }, c));
      if (ci >= 0) hits.push({ comp: ci, rating: p.rating, date: p.date, ts: p.ts, text: p.text, link: p.link, title: p.title });
    }
    prof.compHits = hits;
  }
}

/* ───────────────────────── análisis global ───────────────────────── */

export function runAnalysis(
  params: AnalysisParams,
  clientNeg: Review[],
  compReviews: Review[][],
  profiles: Record<string, ProfileFeatures>
): AnalysisResults {
  const { client, competitors: comps } = params;

  // Índice de autores de la competencia.
  const compIndex: Record<string, EvidenceReview[]> = {};
  const compFetched = compReviews.map((l) => l.length);
  compReviews.forEach((list, ci) => {
    for (const r of list) {
      const cid = r.user.contributorId;
      if (!cid) continue;
      (compIndex[cid] ??= []).push({ comp: ci, rating: r.rating, date: r.date, ts: r.ts, text: short(r.text), link: r.link, title: comps[ci]?.title });
    }
  });

  // Negativas agrupadas por autor.
  const byAuthor = new Map<string, { user: Review["user"]; reviews: Review[] }>();
  for (const r of clientNeg) {
    const cid = r.user.contributorId || `anon_${r.reviewId}_${r.user.name}`;
    const e = byAuthor.get(cid) ?? { user: r.user, reviews: [] };
    e.reviews.push(r);
    byAuthor.set(cid, e);
  }

  // Textos casi idénticos entre negativas de perfiles distintos.
  const similar: SimilarPair[] = [];
  const similarIds = new Set<string>();
  const flat = clientNeg.filter((r) => r.text.trim().length >= 25);
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[i].user.contributorId && flat[i].user.contributorId === flat[j].user.contributorId) continue;
      const sim = similarity(flat[i].text, flat[j].text);
      if (sim >= 0.5) {
        similar.push({
          a: flat[i].reviewId, b: flat[j].reviewId, sim: Math.round(sim * 100) / 100,
          aName: flat[i].user.name, bName: flat[j].user.name, aText: short(flat[i].text, 220), bText: short(flat[j].text, 220)
        });
        similarIds.add(flat[i].reviewId);
        similarIds.add(flat[j].reviewId);
      }
    }
  }

  const authors: Author[] = [];
  byAuthor.forEach((a, cid) => {
    authors.push(scoreAuthor(cid, a.user, a.reviews, compIndex[cid] ?? [], profiles[cid] ?? null, params, similarIds));
  });
  authors.sort((x, y) => y.score - x.score || y.crossPos - x.crossPos);

  const stats = {
    clientNeg: clientNeg.length,
    authors: authors.length,
    authorsMatched: authors.filter((a) => a.compReviews.length > 0).length,
    authorsCrossPos: authors.filter((a) => a.crossPos > 0).length,
    high: authors.filter((a) => a.level === "alto").length,
    medium: authors.filter((a) => a.level === "medio").length,
    low: authors.filter((a) => a.level === "bajo").length,
    profilesDeep: Object.keys(profiles).length,
    compFetched,
    similarPairs: similar.length,
    suspectNegReviews: authors.reduce((s, a) => s + (a.level !== "bajo" ? a.clientReviews.length : 0), 0)
  };

  const impact = ratingImpact(client, comps, authors);
  const timeline = buildTimeline(clientNeg, authors);

  return {
    generatedAt: new Date().toISOString(),
    client,
    competitors: comps,
    params: { negThreshold: params.negThreshold, posThreshold: params.posThreshold, windowDays: params.windowDays, dateFrom: params.dateFrom, deep: params.deep },
    stats,
    impact,
    authors,
    similar: similar.slice(0, 30),
    timeline,
    findings: buildFindings(stats, authors, impact, comps, similar)
  };
}

function scoreAuthor(
  cid: string,
  user: Review["user"],
  neg: Review[],
  compDirect: EvidenceReview[],
  profile: ProfileFeatures | null,
  params: AnalysisParams,
  similarIds: Set<string>
): Author {
  const comps = params.competitors;
  const posTh = params.posThreshold;
  const signals: Signal[] = [];
  const add = (code: string, points: number, label: string, detail = "") => signals.push({ code, points, label, detail });

  // Reseñas en la competencia (listado directo + historial del perfil), sin duplicar.
  const merged = new Map<string, EvidenceReview>();
  for (const c of compDirect) merged.set(`${c.comp}|${c.date}|${c.rating}`, c);
  for (const c of profile?.compHits ?? []) {
    const k = `${c.comp}|${c.date}|${c.rating}`;
    if (!merged.has(k)) merged.set(k, { ...c, title: comps[c.comp ?? 0]?.title });
  }
  const compReviews = [...merged.values()];
  const pos = compReviews.filter((c) => c.rating >= posTh);
  const posComps = [...new Set(pos.map((c) => c.comp ?? 0))];

  if (pos.length) {
    add("cross_pos", 40, "Valoró positivamente a la competencia", posComps.map((i) => comps[i]?.title).join(", "));
    if (posComps.length > 1) add("cross_multi", 10, "Valoración positiva a varios competidores", `${posComps.length} competidores`);
  } else if (compReviews.length) {
    add("cross_any", 10, "También reseñó a la competencia (sin valoración positiva)");
  }

  let gap: number | null = null;
  for (const n of neg) for (const p of pos) if (n.ts && p.ts) {
    const g = Math.abs(n.ts - p.ts) / DAY;
    gap = gap == null ? g : Math.min(gap, g);
  }
  if (gap != null) {
    if (gap <= 2) add("gap_2d", 15, "Negativa al cliente y positiva al competidor casi simultáneas", `${fmt(gap)} días de diferencia`);
    else if (gap <= params.windowDays) add("gap_window", 8, "Negativa y positiva dentro de la ventana temporal", `${Math.round(gap)} días de diferencia`);
  }

  const total = profile ? profile.totalReviews : user.reviews;
  const localGuide = profile ? profile.localGuide : user.localGuide;
  const level = profile ? profile.level : 0;

  if (total > 0 && total <= 3) add("low_activity", 12, "Perfil con muy poca actividad", `${total} reseña(s) en total`);
  else if (total > 0 && total <= 10) add("low_activity", 6, "Perfil con poca actividad", `${total} reseñas en total`);

  if (neg.some((r) => !r.text.trim())) add("no_text", 4, "Reseña negativa sin texto (sólo estrellas)");
  if (neg.length > 1) add("repeat", 6, "Varias reseñas negativas del mismo perfil al cliente", `${neg.length} reseñas`);
  if (neg.some((r) => similarIds.has(r.reviewId))) add("similar_text", 10, "Texto muy parecido al de otra reseña negativa de otro perfil");

  if (profile) {
    if (profile.fetched >= 5 && (profile.extremePct ?? 0) >= 0.85) add("polarized", 6, "Sólo publica valoraciones extremas (1★ o 5★)", `${Math.round((profile.extremePct ?? 0) * 100)}% de sus reseñas`);
    if (profile.sectorNegN >= 2) add("sector_attack", 10, "Reseñas negativas a otros negocios del mismo sector", `${profile.sectorNegN} negocios`);
    if (profile.burst >= 4) add("burst", 6, "Publicó muchas reseñas el mismo día que la negativa", `${profile.burst} reseñas en ±1 día`);
    const firstNeg = Math.min(...neg.map((r) => r.ts || Number.MAX_SAFE_INTEGER));
    if (profile.firstTs && firstNeg !== Number.MAX_SAFE_INTEGER && total <= 5 && firstNeg - profile.firstTs <= 30 * DAY) {
      add("new_account", 8, "Cuenta que empezó a reseñar justo antes de la negativa", `primera reseña: ${tsDate(profile.firstTs)}`);
    }
    if (profile.medianKm != null && profile.fetched >= 3 && profile.medianKm > 150 && (profile.nearPct ?? 1) < 0.1) {
      add("far", 3, "Su actividad habitual está lejos del negocio", `mediana ${Math.round(profile.medianKm)} km`);
    }
  }

  if (localGuide && level >= 5 && total >= 50) add("credible", -12, `Local Guide consolidado (nivel ${level}, ${total} reseñas)`);
  else if (total >= 100) add("credible", -8, `Perfil con mucha actividad (${total} reseñas)`);
  if (neg.some((r) => r.photos > 0)) add("photos", -4, "La reseña negativa incluye fotos propias");

  const score = Math.max(0, Math.min(100, signals.reduce((s, x) => s + x.points, 0)));
  const lvl: Level = score >= LEVEL_HIGH ? "alto" : score >= LEVEL_MEDIUM ? "medio" : "bajo";
  const realCid = cid.startsWith("anon_") ? "" : cid;

  return {
    cid: realCid,
    name: user.name || profile?.name || "Usuario de Google",
    link: user.link || (realCid ? `https://www.google.com/maps/contrib/${realCid}/reviews` : ""),
    thumbnail: user.thumbnail || profile?.thumbnail || "",
    localGuide,
    totalReviews: total,
    score,
    level: lvl,
    crossPos: pos.length,
    gapDays: gap != null ? Math.round(gap * 10) / 10 : null,
    signals,
    clientReviews: neg.map((r) => ({ rating: r.rating, date: r.date, ts: r.ts, text: short(r.text), link: r.link, reviewId: r.reviewId, photos: r.photos })),
    compReviews,
    profile: profile
      ? {
          avgRating: profile.avgRating,
          extremePct: profile.extremePct,
          fetched: profile.fetched,
          medianKm: profile.medianKm,
          first: tsDate(profile.firstTs),
          sectorNeg: profile.sectorNeg,
          sectorNegN: profile.sectorNegN,
          recent: profile.recent,
          level: profile.level
        }
      : null
  };
}

function ratingImpact(client: Place, comps: Place[], authors: Author[]): AnalysisResults["impact"] {
  const out: AnalysisResults["impact"] = { client: null, competitors: {} };
  const sus = authors.filter((a) => a.level !== "bajo");

  let k = 0;
  let s = 0;
  for (const a of sus) for (const r of a.clientReviews) {
    k++;
    s += r.rating;
  }
  if (client.rating && client.reviews && client.reviews > k && k > 0) {
    const nw = (client.rating * client.reviews - s) / (client.reviews - k);
    out.client = { current: client.rating, without: Math.round(Math.min(5, nw) * 100) / 100, removed: k };
  }

  comps.forEach((c, i) => {
    let kk = 0;
    let ss = 0;
    for (const a of sus) for (const r of a.compReviews) if ((r.comp ?? 0) === i) {
      kk++;
      ss += r.rating;
    }
    if (c.rating && c.reviews && c.reviews > kk && kk > 0) {
      const nw = (c.rating * c.reviews - ss) / (c.reviews - kk);
      out.competitors[i] = { current: c.rating, without: Math.round(Math.max(1, nw) * 100) / 100, removed: kk };
    }
  });
  return out;
}

function monthKey(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 7);
}

function buildTimeline(clientNeg: Review[], authors: Author[]): AnalysisResults["timeline"] {
  const levelByReview = new Map<string, Level>();
  const compPos: Record<string, number> = {};
  for (const a of authors) {
    for (const r of a.clientReviews) levelByReview.set(r.reviewId ?? "", a.level);
    if (a.level !== "bajo") for (const c of a.compReviews) if (c.ts) compPos[monthKey(c.ts)] = (compPos[monthKey(c.ts)] ?? 0) + 1;
  }
  const months: AnalysisResults["timeline"] = {};
  const ensure = (m: string) => (months[m] ??= { neg: 0, suspect: 0, compPos: 0 });
  for (const r of clientNeg) {
    if (!r.ts) continue;
    const m = ensure(monthKey(r.ts));
    m.neg++;
    if ((levelByReview.get(r.reviewId) ?? "bajo") !== "bajo") m.suspect++;
  }
  for (const [m, n] of Object.entries(compPos)) ensure(m).compPos = n;

  const keys = Object.keys(months).sort();
  if (!keys.length) return {};
  // Rellenar huecos; máximo 24 meses.
  const [ey, em] = keys[keys.length - 1].split("-").map(Number);
  const [sy, sm] = keys[0].split("-").map(Number);
  let startIdx = sy * 12 + (sm - 1);
  const endIdx = ey * 12 + (em - 1);
  startIdx = Math.max(startIdx, endIdx - 23);
  const filled: AnalysisResults["timeline"] = {};
  for (let i = startIdx; i <= endIdx; i++) {
    const k = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
    filled[k] = months[k] ?? { neg: 0, suspect: 0, compPos: 0 };
  }
  return filled;
}

function buildFindings(
  st: AnalysisResults["stats"],
  authors: Author[],
  impact: AnalysisResults["impact"],
  comps: Place[],
  similar: SimilarPair[]
): string[] {
  if (!st.clientNeg) return ["No se han encontrado reseñas negativas en el periodo analizado."];
  const f: string[] = [];
  const pct = st.authors ? Math.round((st.authorsCrossPos / st.authors) * 100) : 0;
  f.push(`${st.authorsCrossPos} de los ${st.authors} perfiles que han dejado reseñas negativas (${pct}%) han valorado positivamente a la competencia analizada.`);
  if (st.high || st.medium) f.push(`${st.high} perfiles presentan riesgo ALTO y ${st.medium} riesgo MEDIO de ser reseñas no auténticas; suman ${st.suspectNegReviews} reseñas negativas al cliente.`);
  const fast = authors.filter((a) => a.gapDays != null && a.gapDays <= 2).length;
  if (fast) f.push(`${fast} perfiles publicaron la reseña negativa al cliente y la positiva al competidor con menos de 48 horas de diferencia.`);
  if (impact.client) f.push(`Sin las ${impact.client.removed} reseñas de perfiles sospechosos, la nota del cliente sería ${fmt(impact.client.without, 2)}★ en lugar de ${fmt(impact.client.current)}★.`);
  for (const [i, im] of Object.entries(impact.competitors)) {
    if (Math.abs(im.current - im.without) < 0.01) continue;
    f.push(`La nota de ${comps[Number(i)]?.title} bajaría de ${fmt(im.current)}★ a ${fmt(im.without, 2)}★ sin las ${im.removed} valoraciones de esos mismos perfiles.`);
  }
  if (similar.length) f.push(`Se han detectado ${similar.length} pares de reseñas negativas de perfiles distintos con redacción casi idéntica.`);
  const attack = authors.filter((a) => a.profile && a.profile.sectorNegN >= 2 && a.level !== "bajo").length;
  if (attack) f.push(`${attack} perfiles sospechosos también han puntuado negativamente a otros negocios del mismo sector.`);
  return f;
}
