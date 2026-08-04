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

/** Descarga HTML a través de Scrapfly (render JS, IP española, anti-bot). */
async function scrapflyFetch(url: string, apiKey: string): Promise<string> {
  const api = `https://api.scrapfly.io/scrape?key=${encodeURIComponent(apiKey)}&asp=true&render_js=true&country=es&url=${encodeURIComponent(url)}`;
  const resp = await fetch(api, { signal: AbortSignal.timeout(45000) });
  const data: any = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(`Scrapfly ${resp.status}: ${data?.message ?? "error"}`);
  const html = data?.result?.content;
  if (typeof html !== "string" || !html) throw new Error("Scrapfly: respuesta sin contenido");
  return html;
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
async function collectLinkedIn(keyword: string, location: string, apiKey: string): Promise<RawOffer[]> {
  const out: RawOffer[] = [];
  // Ámbito geográfico. Si el usuario pidió una provincia/ciudad, acotamos a
  // "<zona>, España" (LinkedIn geolocaliza el texto). Si no, forzamos España a
  // nivel país con su geoId — SIN esto la API "guest" devuelve ofertas de todo
  // el mundo (el bug de empresas de EE. UU.).
  const wanted = location.trim();
  const loc = wanted ? `${wanted}, España` : "España";
  const geoParam = wanted ? "" : `&geoId=${LINKEDIN_SPAIN_GEOID}`;
  // La API "guest" pagina de 10 en 10 con `start`. Tomamos 3 páginas (~30
  // ofertas) para acotar el coste de Scrapfly.
  for (const start of [0, 10, 20]) {
    if (out.length >= 40) break;
    const url =
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keyword)}` +
      `&location=${encodeURIComponent(loc)}${geoParam}&start=${start}`;
    let html = "";
    try {
      html = await scrapflyFetch(url, apiKey);
    } catch {
      break; // si una página falla, no insistimos
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
  let html = "";
  try {
    html = await scrapflyFetch(url, apiKey);
  } catch {
    return [];
  }
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

/** geoId de España en LinkedIn (fuerza el ámbito país en la API guest). */
const LINKEDIN_SPAIN_GEOID = "105646813";

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
async function fetchJobDescription(jobUrl: string, apiKey: string): Promise<string | null> {
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
  const keyword = opts.keyword.trim() || "marketing";
  // Zona pedida: en scope "spain" no hay provincia (toda España); en "custom"
  // el usuario elige provincia/ciudad y filtramos por ella.
  const wanted = opts.scope === "spain" ? "" : opts.location.trim();
  // Ejecuta ambos portales en paralelo; cada uno es best-effort.
  const [li, ij] = await Promise.all([
    collectLinkedIn(keyword, wanted, opts.apiKey).catch(() => [] as RawOffer[]),
    collectInfoJobs(keyword, opts.apiKey).catch(() => [] as RawOffer[])
  ]);

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

  // Descripción de la oferta: para leerla sin abrir el enlace. La que no la trае
  // (LinkedIn no la da en el listado) se baja de su ficha, best-effort y acotado
  // por coste (cada descarga es una llamada a Scrapfly).
  const entries = [...byCompany.values()];
  const MAX_DESC = 40;
  const DESC_CHUNK = 5;
  const toFetch = entries.filter((o) => !o.description && o.jobUrl).slice(0, MAX_DESC);
  for (let i = 0; i < toFetch.length; i += DESC_CHUNK) {
    const slice = toFetch.slice(i, i + DESC_CHUNK);
    await Promise.all(
      slice.map(async (o) => {
        o.description = await fetchJobDescription(o.jobUrl as string, opts.apiKey).catch(() => null);
      })
    );
  }

  const out: PlacesResult[] = [];
  for (const [key, o] of byCompany) {
    out.push({
      placeId: `jobs:${key}`,
      name: o.company,
      formattedAddress: o.location,
      province: o.location || opts.location.trim() || null,
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
    });
  }
  return out;
}
