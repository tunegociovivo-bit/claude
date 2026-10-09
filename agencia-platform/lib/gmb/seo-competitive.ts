/**
 * Informe SEO local competitivo de una ficha.
 *
 * Compara la ficha con los negocios mejor posicionados en Google Maps para su palabra clave
 * principal (buscando desde su ciudad) en los factores que más pesan en el ranking local:
 *   relevancia (categoría, palabra clave en el nombre/web), prominencia (reseñas, nota, ritmo de
 *   reseñas, citaciones y menciones en la web, enlaces), y calidad de ficha y web (fotos, horario,
 *   descripción, HTTPS, schema LocalBusiness, NAP, contenido).
 * Devuelve todos los datos, las brechas frente al top 3 y un plan de acción priorizado.
 *
 * Fuentes: Google Places API (New) con la Maps key del Hub, Google Business Profile de la propia
 * ficha, la web de cada negocio, y (si hay claves) Serper.dev o SerpApi para menciones/citaciones
 * y el ritmo de reseñas. Lo que no se pueda medir se marca como no disponible, nunca se inventa.
 */
import { prisma } from "@/lib/db/prisma";
import { getGmbMapsKey } from "@/lib/integrations/gmb-hub";
import { getSerpApiKey, SerpApiClient } from "@/lib/integrations/serpapi";
import { SerperReviewsClient } from "@/lib/integrations/serper-reviews";
import { getSeoBlogSettings } from "@/lib/seo-blog/settings";
import { gbpCall, gbpSourceForClient, gmbLocationPath } from "@/lib/integrations/gmb";
import { cityFromAddress, normName, provinceFromAddress, rankCompetitors } from "@/lib/gmb/competitor-ranking";
import { citationStats } from "@/lib/gmb/server";

const DAY = 86_400_000;

export type WebAudit = {
  url: string;
  ok: boolean;
  https: boolean;
  status: number | null;
  title: string;
  metaDescription: boolean;
  h1: string;
  keywordInTitle: boolean;
  keywordInH1: boolean;
  cityInContent: boolean;
  phoneInContent: boolean;
  localBusinessSchema: boolean;
  viewport: boolean;
  words: number;
  loadMs: number | null;
};

export type Competitor = {
  position: number | null;
  isYou: boolean;
  name: string;
  placeId: string;
  address: string;
  category: string;
  categoriesCount: number;
  rating: number | null;
  reviews: number;
  reviewsPerMonth: number | null;
  lastReview: string | null;
  photos: number | null; // Places devuelve como mucho 10
  hasWebsite: boolean;
  website: string;
  hasHours: boolean;
  hasDescription: boolean;
  keywordInName: boolean;
  distanceKm: number | null;
  mentions: number | null;
  directories: string[];
  domainMentions: number | null;
  web: WebAudit | null;
};

export type Gap = { area: string; label: string; you: string; top3: string; severity: "alta" | "media" | "baja" };
export type Action = { priority: number; area: string; action: string; why: string; impact: "alto" | "medio" | "bajo" };

export type SeoCompetitiveReport = {
  keyword: string;
  origin: string;
  generatedAt: string;
  sources: { places: boolean; search: "serper" | "serpapi" | null; reviews: "serper" | "serpapi" | null; ranking: string };
  yourPosition: number | null;
  totalResults: number;
  you: Competitor;
  competitors: Competitor[];
  top3: { rating: number | null; reviews: number; reviewsPerMonth: number | null; photos: number | null; mentions: number | null; keywordInName: number; websites: number; schema: number };
  own: { photos: number | null; postsLast30: number | null; descriptionLength: number | null; additionalCategories: number | null; citations: { total: number; published: number; inconsistent: number } };
  scores: { relevance: number; prominence: number; quality: number; total: number };
  gaps: Gap[];
  actions: Action[];
  aiSummary: string | null;
  warnings: string[];
};

/* ───────────────────────── utilidades ───────────────────────── */

const hostOf = (u: string) => {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)) * 10) / 10;
}

const STOP = new Set(["en", "de", "la", "el", "los", "las", "y", "del", "para", "a", "con", "cerca", "mi", "mejor", "mejores"]);
/** Palabras significativas de la keyword sin la ciudad («clínica estética en marbella» → clinica, estetica). */
export function keywordTerms(keyword: string, city: string): string[] {
  const c = new Set(normName(city).split(" "));
  return normName(keyword)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w) && !c.has(w));
}
/** ¿Contiene todas las palabras de la keyword (admite variaciones de final: clínica/clínicas/clinic)? */
export function containsTerms(text: string, terms: string[], min = terms.length): boolean {
  if (!terms.length) return false;
  const t = ` ${normName(text)} `;
  const hits = terms.filter((w) => t.includes(` ${w}`) || t.includes(` ${w.slice(0, Math.max(4, w.length - 2))}`));
  return hits.length >= Math.max(1, Math.min(min, terms.length));
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

const DIRECTORY_HOSTS: Record<string, string> = {
  "paginasamarillas.es": "Páginas Amarillas",
  "yelp.es": "Yelp",
  "yelp.com": "Yelp",
  "tripadvisor.es": "Tripadvisor",
  "tripadvisor.com": "Tripadvisor",
  "doctoralia.es": "Doctoralia",
  "topdoctors.es": "Top Doctors",
  "facebook.com": "Facebook",
  "instagram.com": "Instagram",
  "linkedin.com": "LinkedIn",
  "es.linkedin.com": "LinkedIn",
  "youtube.com": "YouTube",
  "tiktok.com": "TikTok",
  "cylex.es": "Cylex",
  "infoisinfo.es": "infoisinfo",
  "hotfrog.es": "Hotfrog",
  "firmania.es": "Firmania",
  "habitissimo.es": "Habitissimo",
  "milanuncios.com": "Milanuncios",
  "eltenedor.es": "ElTenedor",
  "thefork.es": "TheFork",
  "trustpilot.com": "Trustpilot",
  "es.trustpilot.com": "Trustpilot",
  "foursquare.com": "Foursquare",
  "waze.com": "Waze",
  "bing.com": "Bing",
  "apple.com": "Apple Maps",
  "empresite.eleconomista.es": "Empresite",
  "einforma.com": "eInforma",
  "infoempresa.com": "Infoempresa",
  "axesor.es": "Axesor",
  "guiaempresas.universia.es": "Guía Empresas",
  "cronoshare.com": "Cronoshare",
  "treatwell.es": "Treatwell",
  "booksy.com": "Booksy",
  "fresha.com": "Fresha",
  "whatclinic.com": "WhatClinic",
  "clinicas.com": "Clinicas.com",
  "masquemedicos.com": "Másquemédicos",
  "nicedayclinic.com": "NiceDay",
  "local.infobel.es": "Infobel",
  "infobel.com": "Infobel",
  "vulka.es": "Vulka",
  "11870.com": "11870",
  "qdq.com": "QDQ",
  "abctelefonos.com": "ABC Teléfonos",
  "guiadeempresas.es": "Guía de empresas"
};
const directoryName = (host: string) => {
  for (const [h, n] of Object.entries(DIRECTORY_HOSTS)) if (host === h || host.endsWith(`.${h}`)) return n;
  return null;
};

type Searcher = { kind: "serper" | "serpapi"; search: (q: string) => Promise<{ link: string; title: string }[]> };

async function makeSearcher(workspaceId: string): Promise<Searcher | null> {
  const serper = (await getSeoBlogSettings(workspaceId).catch(() => null))?.serperApiKey ?? null;
  if (serper) {
    return {
      kind: "serper",
      search: async (q) => {
        const r = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": serper, "Content-Type": "application/json" },
          body: JSON.stringify({ q, gl: "es", hl: "es", num: 20 }),
          signal: AbortSignal.timeout(30_000)
        });
        if (!r.ok) throw new Error(`Serper ${r.status}`);
        const d: any = await r.json();
        return (d.organic ?? []).map((o: any) => ({ link: String(o.link ?? ""), title: String(o.title ?? "") }));
      }
    };
  }
  const serp = await getSerpApiKey(workspaceId).catch(() => null);
  if (serp) {
    const c = new SerpApiClient(serp, { cacheDays: 3 });
    return {
      kind: "serpapi",
      search: async (q) => {
        const d = await c.request({ engine: "google", q, hl: "es", gl: "es", num: 20 });
        return (d.organic_results ?? []).map((o: any) => ({ link: String(o.link ?? ""), title: String(o.title ?? "") }));
      }
    };
  }
  return null;
}

async function makeReviewSource(workspaceId: string): Promise<{ kind: "serper" | "serpapi"; c: any } | null> {
  const serper = (await getSeoBlogSettings(workspaceId).catch(() => null))?.serperApiKey ?? null;
  if (serper) return { kind: "serper", c: new SerperReviewsClient(serper, { cacheDays: 2 }) };
  const serp = await getSerpApiKey(workspaceId).catch(() => null);
  if (serp) return { kind: "serpapi", c: new SerpApiClient(serp, { cacheDays: 2 }) };
  return null;
}

/** Ritmo de reseñas (reseñas/mes) a partir de la primera página de reseñas más recientes. */
async function reviewVelocity(src: { c: any } | null, placeId: string): Promise<{ perMonth: number | null; last: string | null }> {
  if (!src || !placeId) return { perMonth: null, last: null };
  try {
    const d = await src.c.reviews({ place_id: placeId }, "newestFirst");
    const dates = (d?.reviews ?? [])
      .map((r: any) => (r.iso_date ? new Date(r.iso_date).getTime() : NaN))
      .filter((t: number) => Number.isFinite(t))
      .sort((a: number, b: number) => b - a);
    if (!dates.length) return { perMonth: null, last: null };
    const spanDays = Math.max(7, (Date.now() - dates[dates.length - 1]) / DAY);
    return { perMonth: Math.round((dates.length / spanDays) * 30 * 10) / 10, last: new Date(dates[0]).toISOString() };
  } catch {
    return { perMonth: null, last: null };
  }
}

const DETAIL_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "primaryTypeDisplayName",
  "types",
  "websiteUri",
  "nationalPhoneNumber",
  "regularOpeningHours.weekdayDescriptions",
  "photos",
  "editorialSummary",
  "reviews"
].join(",");

async function placeDetails(key: string, placeId: string): Promise<any | null> {
  if (!placeId) return null;
  try {
    const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=es`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAIL_MASK },
      signal: AbortSignal.timeout(15_000)
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Auditoría rápida de la página principal de la web. */
export async function auditWebsite(url: string, terms: string[], city: string, phone: string): Promise<WebAudit | null> {
  if (!url) return null;
  const full = url.startsWith("http") ? url : `https://${url}`;
  const t0 = Date.now();
  try {
    const r = await fetch(full, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NegocioVivoSEO/1.0)", Accept: "text/html" }
    });
    const loadMs = Date.now() - t0;
    const html = (await r.text()).slice(0, 1_500_000);
    const pick = (re: RegExp) => (html.match(re)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i).slice(0, 160);
    const h1 = pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i).slice(0, 160);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
    const digits = phone.replace(/\D/g, "").slice(-9);
    return {
      url: r.url || full,
      ok: r.ok,
      https: (r.url || full).startsWith("https://"),
      status: r.status,
      title,
      metaDescription: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{30,}/i.test(html),
      h1,
      keywordInTitle: containsTerms(title, terms),
      keywordInH1: containsTerms(h1, terms),
      cityInContent: !!city && normName(text).includes(normName(city)),
      phoneInContent: digits.length >= 9 && text.replace(/\D/g, "").includes(digits),
      localBusinessSchema: /"@type"\s*:\s*"?(LocalBusiness|MedicalBusiness|MedicalClinic|Dentist|Physician|HealthAndBeautyBusiness|BeautySalon|DaySpa|Restaurant|Store|ProfessionalService|LegalService|Attorney|HomeAndConstructionBusiness|AutomotiveBusiness|LodgingBusiness|FoodEstablishment|MovingCompany)/i.test(html),
      viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
      words: text.split(" ").filter((w) => w.length > 2).length,
      loadMs
    };
  } catch {
    return { url: full, ok: false, https: full.startsWith("https://"), status: null, title: "", metaDescription: false, h1: "", keywordInTitle: false, keywordInH1: false, cityInContent: false, phoneInContent: false, localBusinessSchema: false, viewport: false, words: 0, loadMs: null };
  }
}

/** Menciones del negocio en la web (citaciones) y del dominio en otras webs (enlaces/menciones). */
async function webPresence(s: Searcher | null, name: string, city: string, website: string) {
  if (!s) return { mentions: null, directories: [] as string[], domainMentions: null };
  const own = hostOf(website);
  let mentions: number | null = null;
  let directories: string[] = [];
  let domainMentions: number | null = null;
  try {
    const res = await s.search(`"${name}" ${city}`.trim());
    const hosts = new Set<string>();
    const dirs = new Set<string>();
    for (const r of res) {
      const h = hostOf(r.link);
      if (!h || h === own || h.endsWith("google.com") || h.endsWith("google.es")) continue;
      hosts.add(h);
      const d = directoryName(h);
      if (d) dirs.add(d);
    }
    mentions = hosts.size;
    directories = [...dirs];
  } catch {
    /* sin datos */
  }
  if (own) {
    try {
      const res = await s.search(`"${own}" -site:${own}`);
      domainMentions = new Set(res.map((r) => hostOf(r.link)).filter((h) => h && h !== own)).size;
    } catch {
      /* sin datos */
    }
  }
  return { mentions, directories, domainMentions };
}

/* ───────────────────────── informe ───────────────────────── */

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
const fmt = (n: number | null | undefined, d = 0) => (n == null ? "–" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: d }).format(n));

export async function buildSeoCompetitiveReport(workspaceId: string, clientId: string, opts: { keyword?: string; topN?: number } = {}): Promise<SeoCompetitiveReport> {
  const client = await prisma.gmbClient.findFirst({ where: { id: clientId, workspaceId } });
  if (!client) throw new Error("Ficha no encontrada");
  const warnings: string[] = [];
  const city = cityFromAddress(client.address);
  const province = provinceFromAddress(client.address);
  const base = (client.mainKeyword || client.category || client.name).trim();
  const keyword = (opts.keyword || (city && !normName(base).includes(normName(city)) ? `${base} en ${city}` : base)).trim();
  const terms = keywordTerms(keyword, city);
  const topN = Math.max(3, Math.min(opts.topN ?? 10, 15));

  // 1) Ranking real para la keyword desde la ciudad del negocio.
  const rank = await rankCompetitors({
    workspaceId,
    keyword,
    province,
    scope: "ciudad",
    you: { name: client.name, placeId: client.placeId, lat: client.latitude, lng: client.longitude },
    pages: 1
  });
  const top = rank.results.filter((r) => !r.isYou).slice(0, topN);
  const youRank = rank.results.find((r) => r.isYou) ?? null;

  const mapsKey = await getGmbMapsKey(workspaceId);
  if (!mapsKey) warnings.push("Sin Google Maps API key: no se pueden leer fotos, horario ni categorías de la competencia.");
  const searcher = await makeSearcher(workspaceId);
  if (!searcher) warnings.push("Sin clave de Serper o SerpApi: no se miden citaciones, menciones ni enlaces.");
  const revSrc = await makeReviewSource(workspaceId);
  if (!revSrc) warnings.push("Sin clave de Serper o SerpApi: el ritmo de reseñas de la competencia es aproximado.");

  // 2) Datos de cada negocio (top + tú).
  const targets: { position: number | null; isYou: boolean; name: string; placeId: string; address: string; rating: number | null; reviews: number; category: string }[] = [
    ...top.map((r) => ({ position: r.position, isYou: false, name: r.name, placeId: r.placeId, address: r.address, rating: r.rating, reviews: r.reviewCount, category: r.category })),
    {
      position: youRank?.position ?? null,
      isYou: true,
      name: client.name,
      placeId: client.placeId || youRank?.placeId || "",
      address: client.address,
      rating: client.rating || youRank?.rating || null,
      reviews: client.reviewCount || youRank?.reviewCount || 0,
      category: client.category || youRank?.category || ""
    }
  ];

  const rows: Competitor[] = await pool(targets, 4, async (t) => {
    const det = mapsKey ? await placeDetails(mapsKey, t.placeId) : null;
    const website = String(det?.websiteUri ?? (t.isYou ? client.website : "") ?? "");
    const phone = String(det?.nationalPhoneNumber ?? (t.isYou ? client.phone : "") ?? "");
    const loc = det?.location ? { lat: det.location.latitude, lng: det.location.longitude } : null;
    const [vel, pres, web] = await Promise.all([
      reviewVelocity(revSrc, t.placeId),
      webPresence(searcher, t.name, city, website),
      website ? auditWebsite(website, terms, city, phone) : Promise.resolve(null)
    ]);
    const types: string[] = Array.isArray(det?.types) ? det.types.filter((x: string) => !["point_of_interest", "establishment"].includes(x)) : [];
    let lastReview = vel.last;
    if (!lastReview && Array.isArray(det?.reviews)) {
      const ts = det.reviews.map((r: any) => (r.publishTime ? new Date(r.publishTime).getTime() : 0)).filter(Boolean);
      if (ts.length) lastReview = new Date(Math.max(...ts)).toISOString();
    }
    return {
      position: t.position,
      isYou: t.isYou,
      name: det?.displayName?.text ?? t.name,
      placeId: t.placeId,
      address: det?.formattedAddress ?? t.address,
      category: det?.primaryTypeDisplayName?.text ?? t.category,
      categoriesCount: types.length,
      rating: typeof det?.rating === "number" ? det.rating : t.rating,
      reviews: Number(det?.userRatingCount ?? t.reviews) || 0,
      reviewsPerMonth: vel.perMonth,
      lastReview,
      photos: det ? (Array.isArray(det.photos) ? det.photos.length : 0) : null,
      hasWebsite: !!website,
      website,
      hasHours: !!det?.regularOpeningHours?.weekdayDescriptions?.length,
      hasDescription: !!det?.editorialSummary?.text,
      keywordInName: containsTerms(det?.displayName?.text ?? t.name, terms),
      distanceKm: loc && rank.center ? kmBetween(rank.center, loc) : null,
      mentions: pres.mentions,
      directories: pres.directories,
      domainMentions: pres.domainMentions,
      web
    };
  });
  const you = rows.find((r) => r.isYou)!;
  const competitors = rows.filter((r) => !r.isYou);

  // 3) Datos propios de la ficha desde Google Business Profile.
  const own: SeoCompetitiveReport["own"] = { photos: null, postsLast30: null, descriptionLength: null, additionalCategories: null, citations: { total: 0, published: 0, inconsistent: 0 } };
  const path = gmbLocationPath(client.accountId, client.locationId);
  const src = gbpSourceForClient(client);
  if (path) {
    await Promise.all([
      gbpCall(workspaceId, src, { api: "v4", path: `/v4/${path}/media?pageSize=1` })
        .then((d) => (own.photos = Number(d?.totalMediaItemCount ?? (d?.mediaItems?.length ?? 0))))
        .catch(() => undefined),
      gbpCall(workspaceId, src, { api: "v4", path: `/v4/${path}/localPosts?pageSize=50` })
        .then((d) => (own.postsLast30 = (d?.localPosts ?? []).filter((p: any) => p.createTime && Date.now() - new Date(p.createTime).getTime() < 30 * DAY).length))
        .catch(() => undefined),
      gbpCall(workspaceId, src, { api: "info", path: `/v1/locations/${path.split("/locations/")[1]}?readMask=${encodeURIComponent("categories,profile")}` })
        .then((d) => {
          own.descriptionLength = String(d?.profile?.description ?? "").length;
          own.additionalCategories = (d?.categories?.additionalCategories ?? []).length;
        })
        .catch(() => undefined)
    ]);
  }
  const cs = await citationStats(prisma as any, workspaceId, client.id).catch(() => null);
  if (cs) own.citations = { total: cs.total, published: cs.published, inconsistent: cs.inconsistent };
  if (own.photos != null) you.photos = own.photos;

  // 4) Comparativa con el top 3.
  const t3 = competitors.filter((c) => c.position != null).slice(0, 3);
  const top3 = {
    rating: avg(t3.map((c) => c.rating)),
    reviews: Math.round(avg(t3.map((c) => c.reviews)) ?? 0),
    reviewsPerMonth: avg(t3.map((c) => c.reviewsPerMonth)),
    photos: avg(t3.map((c) => c.photos)),
    mentions: avg(t3.map((c) => c.mentions)),
    keywordInName: t3.filter((c) => c.keywordInName).length,
    websites: t3.filter((c) => c.hasWebsite).length,
    schema: t3.filter((c) => c.web?.localBusinessSchema).length
  };

  const gaps: Gap[] = [];
  if (top3.reviews && you.reviews < top3.reviews)
    gaps.push({ area: "Reseñas", label: "Número de reseñas", you: fmt(you.reviews), top3: fmt(top3.reviews), severity: you.reviews < top3.reviews * 0.5 ? "alta" : "media" });
  if (top3.rating != null && you.rating != null && you.rating < top3.rating - 0.05)
    gaps.push({ area: "Reseñas", label: "Valoración media", you: fmt(you.rating, 1), top3: fmt(top3.rating, 1), severity: you.rating < top3.rating - 0.3 ? "alta" : "media" });
  if (top3.reviewsPerMonth != null && you.reviewsPerMonth != null && you.reviewsPerMonth < top3.reviewsPerMonth)
    gaps.push({ area: "Reseñas", label: "Reseñas nuevas al mes", you: fmt(you.reviewsPerMonth, 1), top3: fmt(top3.reviewsPerMonth, 1), severity: you.reviewsPerMonth < top3.reviewsPerMonth * 0.5 ? "alta" : "media" });
  if (top3.keywordInName >= 2 && !you.keywordInName)
    gaps.push({ area: "Relevancia", label: "Palabra clave en el nombre de la ficha", you: "No", top3: `${top3.keywordInName} de 3`, severity: "media" });
  if (top3.mentions != null && you.mentions != null && you.mentions < top3.mentions)
    gaps.push({ area: "Citaciones", label: "Webs que mencionan el negocio", you: fmt(you.mentions), top3: fmt(top3.mentions, 1), severity: you.mentions < top3.mentions * 0.6 ? "alta" : "media" });
  const top3Dom = avg(t3.map((c) => c.domainMentions));
  if (top3Dom != null && you.domainMentions != null && you.domainMentions < top3Dom)
    gaps.push({ area: "Enlaces", label: "Webs que enlazan/mencionan tu dominio", you: fmt(you.domainMentions), top3: fmt(top3Dom, 1), severity: "media" });
  if (top3.photos != null && you.photos != null && you.photos < Math.min(10, top3.photos))
    gaps.push({ area: "Ficha", label: "Fotos en la ficha", you: fmt(you.photos), top3: top3.photos >= 10 ? "10+" : fmt(top3.photos), severity: "baja" });
  if (!you.hasWebsite && top3.websites >= 2) gaps.push({ area: "Web", label: "Web enlazada en la ficha", you: "No", top3: `${top3.websites} de 3`, severity: "alta" });
  if (you.web && !you.web.localBusinessSchema && top3.schema >= 1)
    gaps.push({ area: "Web", label: "Schema LocalBusiness en la web", you: "No", top3: `${top3.schema} de 3`, severity: "media" });
  if (you.web && !you.web.keywordInTitle) gaps.push({ area: "Web", label: "Palabra clave en el título de la web", you: "No", top3: `${t3.filter((c) => c.web?.keywordInTitle).length} de 3`, severity: "media" });
  if (own.descriptionLength != null && own.descriptionLength < 400) gaps.push({ area: "Ficha", label: "Descripción de la ficha", you: `${own.descriptionLength} caracteres`, top3: "≥ 400 recomendado", severity: "baja" });
  if (own.postsLast30 != null && own.postsLast30 < 4) gaps.push({ area: "Ficha", label: "Publicaciones en los últimos 30 días", you: fmt(own.postsLast30), top3: "≥ 4 recomendado", severity: "baja" });
  if (own.additionalCategories != null && own.additionalCategories < 2) gaps.push({ area: "Relevancia", label: "Categorías secundarias", you: fmt(own.additionalCategories), top3: "2-5 recomendado", severity: "media" });
  if (own.citations.inconsistent > 0) gaps.push({ area: "Citaciones", label: "Citaciones con datos (NAP) inconsistentes", you: fmt(own.citations.inconsistent), top3: "0", severity: "media" });

  // 5) Puntuaciones (0-100) frente al top 3.
  const ratio = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b <= 0 ? null : Math.min(1, a / b));
  const parts = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) : 0;
  };
  const relevance = parts([you.keywordInName ? 1 : top3.keywordInName ? 0.4 : 0.8, own.additionalCategories != null ? Math.min(1, own.additionalCategories / 3) : null, you.web ? (you.web.keywordInTitle ? 1 : 0.3) : 0.2, you.web ? (you.web.keywordInH1 ? 1 : 0.4) : null]);
  const prominence = parts([ratio(you.reviews, top3.reviews), top3.rating ? ratio(you.rating, top3.rating) : null, ratio(you.reviewsPerMonth, top3.reviewsPerMonth), ratio(you.mentions, top3.mentions), ratio(you.domainMentions, top3Dom)]);
  const quality = parts([
    you.photos != null ? Math.min(1, you.photos / 10) : null,
    you.hasWebsite ? 1 : 0,
    you.hasHours ? 1 : 0.3,
    own.descriptionLength != null ? Math.min(1, own.descriptionLength / 400) : null,
    own.postsLast30 != null ? Math.min(1, own.postsLast30 / 4) : null,
    you.web ? [you.web.https, you.web.localBusinessSchema, you.web.metaDescription, you.web.viewport, you.web.phoneInContent].filter(Boolean).length / 5 : null
  ]);
  const scores = { relevance, prominence, quality, total: Math.round(relevance * 0.3 + prominence * 0.45 + quality * 0.25) };

  // 6) Plan de acción determinista (y redacción con IA si hay clave).
  const actions = buildActions({ you, top3, top3Dom, own, keyword, city, terms, gaps, topDirs: t3.flatMap((c) => c.directories) });
  const report: SeoCompetitiveReport = {
    keyword,
    origin: rank.origin || city,
    generatedAt: new Date().toISOString(),
    sources: { places: !!mapsKey, search: searcher?.kind ?? null, reviews: revSrc?.kind ?? null, ranking: rank.source },
    yourPosition: rank.yourPosition,
    totalResults: rank.results.length,
    you,
    competitors,
    top3,
    own,
    scores,
    gaps,
    actions,
    aiSummary: null,
    warnings
  };
  report.aiSummary = await aiSummary(workspaceId, client.name, report).catch(() => null);
  return report;
}

function buildActions(x: {
  you: Competitor;
  top3: SeoCompetitiveReport["top3"];
  top3Dom: number | null;
  own: SeoCompetitiveReport["own"];
  keyword: string;
  city: string;
  terms: string[];
  gaps: Gap[];
  topDirs: string[];
}): Action[] {
  const a: Omit<Action, "priority">[] = [];
  const { you, top3, own } = x;
  if (top3.reviews && you.reviews < top3.reviews) {
    const need = top3.reviews - you.reviews;
    const perMonth = Math.max(4, Math.ceil(need / 6));
    a.push({
      area: "Reseñas",
      action: `Conseguir unas ${need} reseñas más para igualar la media del top 3 (${top3.reviews}). Objetivo: ${perMonth} reseñas nuevas al mes con el enlace/QR de valoración tras cada servicio.`,
      why: "El número y la frecuencia de reseñas es uno de los factores de prominencia que más pesan en Google Maps.",
      impact: "alto"
    });
  } else if (top3.reviewsPerMonth != null && you.reviewsPerMonth != null && you.reviewsPerMonth < top3.reviewsPerMonth) {
    a.push({ area: "Reseñas", action: `Subir el ritmo a ${Math.ceil(top3.reviewsPerMonth)} reseñas al mes (ahora ${you.reviewsPerMonth}).`, why: "Google premia la actividad reciente de reseñas.", impact: "alto" });
  }
  if (top3.rating != null && you.rating != null && you.rating < top3.rating - 0.05)
    a.push({ area: "Reseñas", action: `Elevar la nota de ${you.rating} a ${top3.rating}+: responder todas las reseñas, resolver quejas y denunciar las que incumplan las políticas (pestaña «Reseñas falsas»).`, why: "Una nota inferior reduce clics y conversiones aunque se aparezca bien posicionado.", impact: "medio" });
  if (!you.keywordInName && top3.keywordInName >= 2)
    a.push({
      area: "Relevancia",
      action: `Valorar incluir «${x.terms.join(" ")}» en el nombre de la ficha SOLO si forma parte del nombre real del negocio (rótulo, web, documentos).`,
      why: `${top3.keywordInName} de los 3 primeros llevan la palabra clave en el nombre. Añadirla sin que sea el nombre real infringe las normas de Google y puede suspender la ficha.`,
      impact: "alto"
    });
  if (own.additionalCategories != null && own.additionalCategories < 2)
    a.push({ area: "Relevancia", action: "Añadir 2-5 categorías secundarias que describan servicios reales (las que usan los competidores del top 3).", why: "Las categorías son el factor de relevancia número uno para aparecer por una búsqueda.", impact: "alto" });
  if (top3.mentions != null && you.mentions != null && you.mentions < top3.mentions)
    a.push({ area: "Citaciones", action: `Darse de alta (con el mismo nombre, dirección y teléfono) en los directorios donde está la competencia y no el negocio: ${missingDirs(x)}.`, why: `La competencia aparece en ${fmt(top3.mentions, 1)} webs de media y el negocio en ${you.mentions}.`, impact: "medio" });
  if (own.citations.inconsistent > 0) a.push({ area: "Citaciones", action: `Corregir los datos de las ${own.citations.inconsistent} citaciones con NAP inconsistente (pestaña de citaciones).`, why: "Datos distintos entre webs restan confianza a Google.", impact: "medio" });
  if (x.top3Dom != null && you.domainMentions != null && you.domainMentions < x.top3Dom)
    a.push({ area: "Enlaces", action: "Conseguir enlaces locales a la web: asociaciones y cámaras de comercio, patrocinios, prensa local, proveedores y colaboradores.", why: "Los enlaces a la web refuerzan la autoridad de la ficha.", impact: "medio" });
  if (!you.hasWebsite) a.push({ area: "Web", action: "Enlazar una web propia en la ficha (página de inicio o landing del servicio principal).", why: "La mayoría de fichas del top 3 tienen web y Google la usa para entender la relevancia.", impact: "alto" });
  if (you.web) {
    if (!you.web.keywordInTitle || !you.web.keywordInH1)
      a.push({ area: "Web", action: `Incluir «${x.terms.join(" ")}» y «${x.city}» en el título (title) y el H1 de la página que enlaza la ficha.`, why: "Alinea la web con la búsqueda principal.", impact: "medio" });
    if (!you.web.localBusinessSchema) a.push({ area: "Web", action: "Añadir datos estructurados LocalBusiness (schema.org) con nombre, dirección, teléfono, horario y coordenadas.", why: "Ayuda a Google a asociar la web con la ficha.", impact: "medio" });
    if (!you.web.phoneInContent || !you.web.cityInContent) a.push({ area: "Web", action: "Mostrar el nombre, dirección y teléfono (NAP) idénticos a los de la ficha en el pie de la web.", why: "Coherencia NAP entre ficha y web.", impact: "bajo" });
    if (!you.web.https) a.push({ area: "Web", action: "Activar HTTPS en la web.", why: "Seguridad y confianza para Google y los usuarios.", impact: "medio" });
  }
  if (own.descriptionLength != null && own.descriptionLength < 400) a.push({ area: "Ficha", action: "Reescribir la descripción de la ficha (600-750 caracteres) con los servicios principales y la zona.", why: "Mejora la relevancia y la conversión de la ficha.", impact: "bajo" });
  if (own.postsLast30 != null && own.postsLast30 < 4) a.push({ area: "Ficha", action: "Publicar al menos 1 novedad u oferta por semana en la ficha.", why: "La actividad constante es una señal positiva y mejora la conversión.", impact: "bajo" });
  if (you.photos != null && you.photos < 10) a.push({ area: "Ficha", action: "Subir fotos reales del local, equipo y trabajos (mínimo 10, y 2-3 nuevas al mes).", why: "Las fichas con más fotos reciben más visitas y solicitudes de ruta.", impact: "bajo" });
  a.push({ area: "Seguimiento", action: "Medir el ranking en rejilla cada mes (pestaña «Ranking») y repetir este informe para ver la evolución.", why: "Permite comprobar qué acciones mueven la posición.", impact: "bajo" });
  const w = { alto: 0, medio: 1, bajo: 2 } as const;
  return a.sort((p, q) => w[p.impact] - w[q.impact]).map((v, i) => ({ ...v, priority: i + 1 }));
}

function missingDirs(x: { you: Competitor; topDirs: string[] }) {
  const have = new Set(x.you.directories);
  const count = new Map<string, number>();
  for (const d of x.topDirs) if (!have.has(d)) count.set(d, (count.get(d) ?? 0) + 1);
  const list = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  return list.length ? list.slice(0, 8).join(", ") : "Páginas Amarillas, Bing Places, Apple Business Connect, Cylex y los directorios de tu sector";
}

async function aiSummary(workspaceId: string, name: string, r: SeoCompetitiveReport): Promise<string | null> {
  const { getOpenAiKeyForWorkspace } = await import("@/lib/ai/openai");
  const key = await getOpenAiKeyForWorkspace(workspaceId).catch(() => "");
  if (!key) return null;
  const compact = {
    keyword: r.keyword,
    posicion: r.yourPosition,
    tu: { nota: r.you.rating, reseñas: r.you.reviews, reseñasMes: r.you.reviewsPerMonth, menciones: r.you.mentions, kwEnNombre: r.you.keywordInName, web: !!r.you.web, schema: r.you.web?.localBusinessSchema },
    top3: r.top3,
    competidores: r.competitors.slice(0, 5).map((c) => ({ pos: c.position, nombre: c.name, nota: c.rating, reseñas: c.reviews, reseñasMes: c.reviewsPerMonth, kwEnNombre: c.keywordInName, menciones: c.mentions })),
    brechas: r.gaps.map((g) => `${g.label}: tú ${g.you} vs top3 ${g.top3}`),
    puntuaciones: r.scores
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Eres consultor de SEO local (Google Maps). Con los datos dados, escribe en español un diagnóstico claro de 90-150 palabras para el dueño del negocio: por qué los primeros están por encima y qué 3 cosas concretas harían subir antes a la ficha. Usa solo los datos dados, sin inventar cifras. Sin títulos ni listas."
        },
        { role: "user", content: `Negocio: ${name}\nDatos: ${JSON.stringify(compact)}` }
      ]
    }),
    signal: AbortSignal.timeout(40_000)
  });
  if (!resp.ok) return null;
  const d: any = await resp.json();
  return String(d?.choices?.[0]?.message?.content ?? "").trim() || null;
}
