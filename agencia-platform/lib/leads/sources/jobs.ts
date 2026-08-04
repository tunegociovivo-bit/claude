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

export type RawOffer = { company: string; jobTitle: string | null; location: string | null; jobUrl: string | null; companyUrl: string | null; board: string };

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
  const loc = location.trim() || "España";
  // La API "guest" pagina de 10 en 10 con `start`. Tomamos 3 páginas (~30
  // ofertas) para acotar el coste de Scrapfly.
  for (const start of [0, 10, 20]) {
    if (out.length >= 40) break;
    const url =
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keyword)}` +
      `&location=${encodeURIComponent(loc)}&start=${start}`;
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
async function collectInfoJobs(keyword: string, location: string, apiKey: string): Promise<RawOffer[]> {
  const kwSlug = keyword.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const url = `https://www.infojobs.net/ofertas-trabajo/${encodeURIComponent(kwSlug || "marketing")}`;
  let html = "";
  try {
    html = await scrapflyFetch(url, apiKey);
  } catch {
    return [];
  }
  return parseInfoJobsJsonLd(html, location);
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
        board: "infojobs"
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
  // Ejecuta ambos portales en paralelo; cada uno es best-effort.
  const [li, ij] = await Promise.all([
    collectLinkedIn(keyword, opts.location, opts.apiKey).catch(() => [] as RawOffer[]),
    collectInfoJobs(keyword, opts.location, opts.apiKey).catch(() => [] as RawOffer[])
  ]);

  // Dedup por empresa (una empresa puede tener varias ofertas → 1 lead).
  const byCompany = new Map<string, RawOffer>();
  for (const o of [...li, ...ij]) {
    const key = companyKey(o.company);
    if (!key || key.length < 2) continue;
    if (!byCompany.has(key)) byCompany.set(key, o);
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
        board: o.board
      }
    });
  }
  return out;
}
