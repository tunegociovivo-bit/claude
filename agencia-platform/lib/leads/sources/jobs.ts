/**
 * Fuente "jobs" (Empleos): empresas que TIENEN una oferta de trabajo abierta
 * para un puesto de marketing / IA. Señal comercial potentísima: si contratan
 * a alguien de marketing, ese presupuesto y esa necesidad ya existen → podemos
 * ofrecer hacerlo como servicio (más rápido y barato que contratar y formar).
 *
 * No hay email en la oferta, así que el flujo es:
 *   1) scrapear las ofertas (LinkedIn jobs "guest" + InfoJobs) → EMPRESA + puesto
 *   2) enriquecer web + teléfono con Google Places (en el dispatcher)
 *   3) sacar el email de contacto de la web (en el dispatcher)
 *   4) arrancar la secuencia de email automática (search-manager)
 *
 * Requiere SCRAPFLY_API_KEY (los portales bloquean el fetch directo), igual que
 * Doctoralia/Idealista/Fotocasa. El scraping de portales es frágil por
 * naturaleza (cambian el HTML); por eso combinamos DOS fuentes y cada una es
 * best-effort: si una falla o cambia, la otra sigue aportando.
 */

import type { PlacesResult } from "../google-places";
import { SPAIN_PROVINCES, findProvince } from "../spain-provinces";
import { municipalitiesForProvince } from "../spain-municipalities";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Descarga HTML a través de Scrapfly (render JS, IP española, anti-bot).
 * Reintenta ante 429 (límite de concurrencia del plan) y errores 5xx/red con
 * espera creciente, para no tumbar la búsqueda por un pico transitorio.
 */
async function scrapflyFetch(url: string, apiKey: string): Promise<string> {
  const api = `https://api.scrapfly.io/scrape?key=${encodeURIComponent(apiKey)}&asp=true&render_js=true&country=es&url=${encodeURIComponent(url)}`;
  let lastErr: Error = new Error("Scrapfly: error desconocido");
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(attempt * 2500); // 2,5s, 5s
    let resp: Response;
    try {
      resp = await fetch(api, { signal: AbortSignal.timeout(45000) });
    } catch (e: any) {
      lastErr = new Error(`Scrapfly red: ${e?.message ?? e}`);
      continue; // timeout / error de red → reintenta
    }
    // 429 (concurrencia) y 5xx → transitorios: reintenta.
    if (resp.status === 429 || resp.status >= 500) {
      const d: any = await resp.json().catch(() => null);
      lastErr = new Error(`Scrapfly ${resp.status}: ${d?.message ?? "error"}`);
      continue;
    }
    const data: any = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(`Scrapfly ${resp.status}: ${data?.message ?? "error"}`);
    const html = data?.result?.content;
    if (typeof html !== "string" || !html) throw new Error("Scrapfly: respuesta sin contenido");
    return html;
  }
  throw lastErr;
}

/** Quita etiquetas HTML y decodifica las entidades más comunes. */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n, 10)); } catch { return ""; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCharCode(parseInt(n, 16)); } catch { return ""; } })
    .replace(/\s+/g, " ")
    .trim();
}

export type RawOffer = { company: string; jobTitle: string | null; location: string | null; jobUrl: string | null; companyUrl: string | null; board: string; description?: string | null };

// ── Filtro de PUESTO relevante (marketing / IA) ───────────────────────────
// La búsqueda por keyword en los portales trae de todo (recepcionista,
// comercial, dependiente…). Solo nos interesan empresas que contratan un puesto
// de marketing o IA — es lo que podemos ofrecer como servicio. Filtramos por el
// título de la oferta con una lista de términos afines.
const ROLE_ALLOW = new RegExp(
  [
    "marketing", "marketer", "\\bdigital\\b", "community", "redes sociales", "social media",
    "social ads", "gestion de redes", "gestor de redes", "publicidad", "publicitari",
    "\\bseo\\b", "\\bsem\\b", "\\bppc\\b", "\\bsea\\b", "adwords", "google ads", "meta ads",
    "paid media", "trafficker", "growth", "performance", "contenidos", "contenido",
    "\\bcontent\\b", "copywrit", "\\bcopy\\b", "branding", "\\bmarca\\b", "ecommerce",
    "e-commerce", "comercio electronico", "\\bcrm\\b", "email marketing", "inbound",
    "comunicacion", "inteligencia artificial", "\\bia\\b", "machine learning", "\\bai\\b",
    "data scientist", "cientifico de datos", "analista de datos", "big data", "data analyst",
    "diseno grafico", "diseno digital"
  ].join("|"),
  "i"
);
// Falsos positivos de "digital"/"comunicacion" que NO son marketing (telecom).
const ROLE_BLOCK = /telecomunic|comunicaciones moviles|instalador|fibra optica/i;

// Consultas por defecto cuando el usuario NO indica un puesto: captan empresas
// de CUALQUIER sector que contraten marketing/IA. El filtro isMarketingRole luego
// se queda solo con los títulos afines.
const DEFAULT_ROLE_QUERIES = ["marketing", "community manager", "inteligencia artificial"];

/** ¿El título de la oferta es de un puesto de marketing / IA? */
export function isMarketingRole(jobTitle: string | null | undefined): boolean {
  const n = norm(jobTitle);
  if (!n) return false;
  if (ROLE_BLOCK.test(n)) return false;
  return ROLE_ALLOW.test(n);
}

/**
 * Parsea las tarjetas de oferta del HTML de la API "jobs guest" de LinkedIn.
 * Función PURA (sin red) para poder testearla con HTML de muestra.
 */
export function parseLinkedInCards(html: string): RawOffer[] {
  const out: RawOffer[] = [];
  const cards = html.split(/<li[\s>]/i).slice(1);
  for (const card of cards) {
    const title = pick(card, /base-search-card__title[^>]*>([\s\S]*?)<\/h3>/i);
    const subtitle = pick(card, /base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/i);
    const company = subtitle ? stripTags(subtitle) : null;
    if (!company) continue;
    const loc2 = pick(card, /job-search-card__location[^>]*>([\s\S]*?)<\/span>/i);
    const jobUrl = pickAttr(card, /base-card__full-link[^>]*href="([^"]+)"/i) ?? pickAttr(card, /href="(https:\/\/[a-z.]*linkedin\.com\/jobs\/view\/[^"]+)"/i);
    const companyUrl = subtitle ? pickAttr(subtitle, /href="([^"]*\/company\/[^"]+)"/i) : null;
    out.push({
      company,
      jobTitle: title ? stripTags(title) : null,
      location: loc2 ? stripTags(loc2) : null,
      jobUrl: jobUrl ? jobUrl.split("?")[0] : null,
      companyUrl: companyUrl ? companyUrl.split("?")[0] : null,
      board: "linkedin"
    });
  }
  return out;
}

/**
 * LinkedIn "jobs guest" API (sin login): devuelve tarjetas de oferta con
 * empresa + puesto + ubicación + enlace. Es la fuente más fiable de parsear.
 */
async function collectLinkedIn(keyword: string, location: string, apiKey: string, maxPages = 3): Promise<RawOffer[]> {
  const out: RawOffer[] = [];
  // Ámbito geográfico por TEXTO de ubicación ("<zona>, España"). Es el método
  // probado que sí devuelve resultados españoles; el post-filtro isInSpain hace
  // de red de seguridad. Para "toda España" el llamador itera varias ciudades.
  const loc = location.trim() ? `${location.trim()}, España` : "España";
  // La API "guest" pagina de 10 en 10 con `start`.
  const starts = [0, 10, 20].slice(0, Math.max(1, maxPages));
  for (const start of starts) {
    if (out.length >= 40) break;
    const url =
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keyword)}` +
      `&location=${encodeURIComponent(loc)}&start=${start}`;
    let html = "";
    try {
      html = await scrapflyFetch(url, apiKey);
    } catch (e) {
      if (start === 0) throw e; // la 1ª página falla → es un fallo real (Scrapfly)
      break; // paginación parcial: paramos sin romper
    }
    const cards = parseLinkedInCards(html);
    if (cards.length === 0) break;
    out.push(...cards);
  }
  return out;
}

/**
 * InfoJobs: el portal de empleo líder en España. Sus fichas incluyen JSON-LD
 * schema.org `JobPosting` con `hiringOrganization`. Parseamos esos bloques de
 * la página de resultados (best-effort: si no hay JSON-LD, no aporta).
 */
async function collectInfoJobs(keyword: string, apiKey: string): Promise<RawOffer[]> {
  const kwSlug = keyword.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const url = `https://www.infojobs.net/ofertas-trabajo/${encodeURIComponent(kwSlug || "marketing")}`;
  const html = await scrapflyFetch(url, apiKey); // deja propagar el fallo al llamador
  // Sin fallbackLocation: no inventamos la provincia para las ofertas sin
  // localidad (así el geofiltro por provincia no las da por válidas a ciegas).
  return parseInfoJobsJsonLd(html);
}

/**
 * Extrae ofertas de los bloques JSON-LD `JobPosting` de una página de InfoJobs.
 * Función PURA (sin red) para poder testearla con HTML de muestra.
 */
export function parseInfoJobsJsonLd(html: string, fallbackLocation = ""): RawOffer[] {
  const out: RawOffer[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let nodes: any[] = [];
    try {
      const parsed = JSON.parse(m[1].trim());
      nodes = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ? parsed["@graph"] : [parsed];
    } catch {
      continue;
    }
    for (const n of nodes) {
      const t = n?.["@type"];
      const types = Array.isArray(t) ? t : [t];
      if (!types.some((x: any) => typeof x === "string" && x.toLowerCase() === "jobposting")) continue;
      const company = typeof n?.hiringOrganization?.name === "string" ? n.hiringOrganization.name.trim() : null;
      if (!company) continue;
      const city = n?.jobLocation?.address?.addressLocality ?? n?.jobLocation?.[0]?.address?.addressLocality ?? null;
      out.push({
        company,
        jobTitle: typeof n?.title === "string" ? n.title.trim() : null,
        location: typeof city === "string" ? city : fallbackLocation.trim() || null,
        jobUrl: typeof n?.url === "string" ? n.url : null,
        companyUrl: typeof n?.hiringOrganization?.sameAs === "string" ? n.hiringOrganization.sameAs : null,
        board: "infojobs",
        description: typeof n?.description === "string" ? stripTags(n.description).slice(0, 1800) : null
      });
    }
  }
  return out;
}

function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}
function pickAttr(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

/** Slug estable para el placeId (dedup por empresa). */
function companyKey(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ── Geofiltro España + provincia/ciudad ───────────────────────────────────
// LinkedIn "jobs guest" devuelve ofertas de TODO el mundo si no se acota bien
// (de ahí el bug de empresas de EE. UU.). Acotamos la consulta a España y,
// además, filtramos por texto de ubicación como red de seguridad.

// Ciudades para el barrido "toda España": las áreas metropolitanas con más
// oferta de empleo. LinkedIn geolocaliza por texto ("Madrid, España"), que es el
// método probado. Cubre el grueso del mercado sin disparar el nº de llamadas.
const SPAIN_METROS = ["Madrid", "Barcelona", "Valencia", "Sevilla", "Málaga", "Bilbao"];

/** Normaliza para comparar ubicaciones (minúsculas, sin acentos). */
function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Tokens que delatan que una oferta está EN ESPAÑA: nombre y capital de cada
// provincia. Se usan como señal positiva cuando la tarjeta no dice "España".
const SPAIN_TOKENS: string[] = (() => {
  const t = new Set<string>();
  for (const p of SPAIN_PROVINCES) {
    t.add(norm(p.name));
    t.add(norm(p.capital));
  }
  t.delete("");
  return [...t];
})();

// Marcadores de OTRO país: si aparecen, la oferta NO es de España (evita falsos
// positivos como "Toledo, Ohio" o "Valencia, California").
const FOREIGN_MARKERS = [
  "united states", "estados unidos", "united kingdom", "reino unido", "france",
  "francia", "deutschland", "alemania", "italia", "italy", "portugal", "argentina",
  "mexico", "colombia", "chile", "peru", "venezuela", "ecuador", "brasil", "brazil",
  "netherlands", "ireland", "irlanda", "poland", "polonia", ", oh", ", ny", ", ca",
  ", tx", ", fl", ", il"
];

/** ¿La ubicación de la oferta está en España? (InfoJobs siempre lo está.) */
function isInSpain(loc: string | null, board: string): boolean {
  if (board === "infojobs") return true;
  const n = norm(loc);
  if (!n) return false;
  if (FOREIGN_MARKERS.some((f) => n.includes(f))) return false;
  if (/\bespana\b|\bspain\b/.test(n)) return true;
  return SPAIN_TOKENS.some((tok) => tok && n.includes(tok));
}

/**
 * Baja la ficha de una oferta y extrae el texto de la descripción, para que el
 * usuario lea la oferta sin abrir el enlace. Estrategia uniforme: JSON-LD
 * `JobPosting.description` (lo incluyen tanto LinkedIn como InfoJobs en la ficha)
 * y, como respaldo, el bloque de texto de la descripción de LinkedIn. Best-effort.
 */
export async function fetchJobDescription(jobUrl: string, apiKey: string): Promise<string | null> {
  let html = "";
  try {
    html = await scrapflyFetch(jobUrl, apiKey);
  } catch {
    return null;
  }
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes: any[] = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ? parsed["@graph"] : [parsed];
      for (const n of nodes) {
        const t = n?.["@type"];
        const types = Array.isArray(t) ? t : [t];
        if (types.some((x: any) => typeof x === "string" && x.toLowerCase() === "jobposting") && typeof n?.description === "string") {
          const txt = stripTags(n.description);
          if (txt.length > 40) return txt.slice(0, 1800);
        }
      }
    } catch {
      // JSON-LD inválido → probamos el siguiente bloque
    }
  }
  // Respaldo: markup de descripción de LinkedIn.
  const li =
    pick(html, /show-more-less-html__markup[^>]*>([\s\S]*?)<\/(?:div|section)>/i) ||
    pick(html, /description__text[^>]*>([\s\S]*?)<\/(?:div|section)>/i);
  if (li) {
    const t = stripTags(li);
    if (t.length > 40) return t.slice(0, 1800);
  }
  return null;
}

/** Tokens aceptables para la provincia/ciudad pedida (incluye sus municipios). */
function wantedTokens(wanted: string): string[] {
  const w = wanted.trim();
  if (!w) return [];
  const set = new Set<string>([norm(w)]);
  const prov = findProvince(w);
  if (prov) {
    set.add(norm(prov.name));
    set.add(norm(prov.capital));
    for (const m of municipalitiesForProvince(prov.name)) set.add(norm(m));
  }
  set.delete("");
  return [...set];
}

export async function collectJobs(opts: {
  keyword: string;
  location: string;
  apiKey: string;
  scope: "custom" | "spain";
}): Promise<PlacesResult[]> {
  if (!opts.apiKey) {
    throw new Error("La fuente Empleos necesita la API key de Scrapfly. Configúrala en Ajustes de Leads.");
  }
  // Puesto(s) a buscar. Si el usuario no indica ninguno, usamos un set por
  // defecto para captar empresas de CUALQUIER sector que contraten marketing/IA.
  const queries = opts.keyword.trim() ? [opts.keyword.trim()] : DEFAULT_ROLE_QUERIES;
  // Zona pedida: en scope "spain" no hay provincia (toda España); en "custom"
  // el usuario elige provincia/ciudad y filtramos por ella.
  const wanted = opts.scope === "spain" ? "" : opts.location.trim();
  // Áreas a barrer en LinkedIn: en "custom" solo la zona pedida (3 páginas);
  // en "toda España" iteramos las metrópolis principales (1 página cada una)
  // — el método por TEXTO de ciudad es el que de verdad devuelve resultados.
  const areas = opts.scope === "spain" ? SPAIN_METROS : [wanted];
  const liPages = opts.scope === "spain" ? 1 : 3;

  // Recogida con concurrencia acotada y CONTEO de errores: si TODO falla (0
  // respuestas OK), lanzamos el error para que la búsqueda salga FAILED con el
  // motivo (antes se tragaba y salía "COMPLETED · 0 leads" sin pista).
  const li: RawOffer[] = [];
  const ij: RawOffer[] = [];
  let okCalls = 0;
  let errCalls = 0;
  let lastErr = "";
  const linkedInJobs = queries.flatMap((q) => areas.map((area) => ({ q, area })));
  // Concurrencia BAJA: Scrapfly limita las peticiones simultáneas por plan y
  // devuelve 429 si te pasas. 2 en paralelo es lo que toleró el plan actual.
  const CONC = 2;
  const runChunked = async <T,>(items: T[], fn: (it: T) => Promise<void>) => {
    for (let i = 0; i < items.length; i += CONC) {
      await Promise.all(items.slice(i, i + CONC).map(fn));
    }
  };
  await runChunked(linkedInJobs, async ({ q, area }) => {
    try {
      li.push(...(await collectLinkedIn(q, area, opts.apiKey, liPages)));
      okCalls++;
    } catch (e: any) {
      errCalls++;
      lastErr = String(e?.message ?? e);
    }
  });
  // InfoJobs es nacional (no por ciudad): una consulta por keyword.
  await runChunked(queries, async (q) => {
    try {
      ij.push(...(await collectInfoJobs(q, opts.apiKey)));
      okCalls++;
    } catch (e: any) {
      errCalls++;
      lastErr = String(e?.message ?? e);
    }
  });
  if (okCalls === 0 && errCalls > 0) {
    throw new Error(`No se pudo scrapear ninguna oferta (Scrapfly): ${lastErr}`);
  }

  // Geofiltro: (1) descarta ofertas que no sean de España (arregla el bug de
  // empresas de EE. UU. que colaba LinkedIn); (2) si se pidió una provincia/
  // ciudad, exige que la oferta encaje con esa zona (o sus municipios).
  const wantTokens = wantedTokens(wanted);
  const inScope = (o: RawOffer): boolean => {
    // Solo puestos de marketing / IA (fuera recepcionista, comercial, etc.).
    if (!isMarketingRole(o.jobTitle)) return false;
    if (!isInSpain(o.location, o.board)) return false;
    if (wantTokens.length === 0) return true;
    const n = norm(o.location);
    return !!n && wantTokens.some((t) => n.includes(t));
  };

  // Dedup por empresa (una empresa puede tener varias ofertas → 1 lead). El
  // filtro de puesto se aplica ANTES del dedup: si una empresa tiene una vacante
  // de marketing y otra de recepcionista, nos quedamos con la de marketing.
  const byCompany = new Map<string, RawOffer>();
  for (const o of [...li, ...ij]) {
    if (!inScope(o)) continue;
    const key = companyKey(o.company);
    if (!key || key.length < 2) continue;
    if (!byCompany.has(key)) byCompany.set(key, o);
  }

  // La descripción de la oferta NO se baja aquí (sería 1 llamada extra de Scrapfly
  // por empresa → lento y caro en barridos grandes). InfoJobs ya la trae gratis en
  // su JSON-LD; la de LinkedIn se carga BAJO DEMANDA al desplegar la oferta en el
  // panel (endpoint jobs-review/[id]/description).

  return [...byCompany.values()].map((o) => offerToPlaces(o, opts.location.trim()));
}

/** Mapea una oferta a un lead (PlacesResult) de la fuente jobs. */
export function offerToPlaces(o: RawOffer, fallbackLocation = ""): PlacesResult {
  const key = companyKey(o.company);
  return {
    placeId: `jobs:${key}`,
    name: o.company,
    formattedAddress: o.location,
    province: o.location || fallbackLocation || null,
    types: ["jobs.listing"],
    category: "Empresa que contrata marketing/IA",
    latitude: null,
    longitude: null,
    rating: null,
    userRatingCount: 0,
    priceLevel: null,
    businessStatus: "OPERATIONAL",
    gmbUrl: null,
    website: null,
    phone: null,
    internationalPhone: null,
    rawData: {
      source: "jobs",
      jobsOutreach: true, // marca para arrancar la secuencia de email
      jobTitle: o.jobTitle,
      jobUrl: o.jobUrl,
      companyUrl: o.companyUrl,
      board: o.board,
      jobDescription: o.description ?? null
    }
  };
}

/**
 * Convierte ofertas SUELTAS (p.ej. de la bandeja de alertas por email) en leads:
 * filtra a puestos de marketing/IA, deduplica por empresa y mapea. Sin geofiltro
 * (las alertas ya vienen acotadas por la zona configurada en el portal).
 */
export function offersToLeadResults(offers: RawOffer[], fallbackLocation = ""): PlacesResult[] {
  const byCompany = new Map<string, RawOffer>();
  for (const o of offers) {
    if (!isMarketingRole(o.jobTitle)) continue;
    const key = companyKey(o.company);
    if (!key || key.length < 2) continue;
    if (!byCompany.has(key)) byCompany.set(key, o);
  }
  return [...byCompany.values()].map((o) => offerToPlaces(o, fallbackLocation));
}
