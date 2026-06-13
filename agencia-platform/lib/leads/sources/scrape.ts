/**
 * Conector genérico para directorios públicos (Doctoralia, Idealista, Fotocasa…).
 *
 * Estos sitios bloquean el fetch directo (anti-bot), así que pasamos por un
 * scraper configurable (Scrapfly) que renderiza la página. De la respuesta
 * extraemos los bloques JSON-LD (schema.org) con negocios/profesionales
 * (LocalBusiness, MedicalBusiness, Physician, Dentist, RealEstateAgent…) y los
 * mapeamos a PlacesResult. El teléfono no siempre está en el listado: lo que
 * no traiga teléfono se enriquece luego con Google Places (igual que Meta Ads).
 *
 * Requiere SCRAPFLY_API_KEY. Sin ella, lanza un error claro (la fuente queda
 * inactiva hasta configurarla), igual que Meta Ads con su token.
 */

import type { PlacesResult } from "../google-places";
import { detectSector } from "../ticket-score";

const JSONLD_TYPES = new Set([
  "localbusiness",
  "medicalbusiness",
  "medicalclinic",
  "physician",
  "dentist",
  "hospital",
  "realestateagent",
  "professionalservice",
  "legalservice",
  "store",
  "healthandbeautybusiness"
]);

/** Descarga el HTML renderizado de `url` a través de Scrapfly. */
async function scrapflyFetch(url: string, apiKey: string): Promise<string> {
  const api = `https://api.scrapfly.io/scrape?key=${encodeURIComponent(apiKey)}&asp=true&render_js=true&country=es&url=${encodeURIComponent(url)}`;
  const resp = await fetch(api, { signal: AbortSignal.timeout(45000) });
  const data: any = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(`Scrapfly ${resp.status}: ${data?.message ?? "error"}`);
  const html = data?.result?.content;
  if (typeof html !== "string" || !html) throw new Error("Scrapfly: respuesta sin contenido");
  return html;
}

/** Extrae todos los objetos JSON-LD de un HTML (tolerante a @graph y arrays). */
function extractJsonLd(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ? parsed["@graph"] : [parsed];
      for (const n of nodes) if (n && typeof n === "object") out.push(n);
    } catch {
      // bloque JSON-LD malformado → lo saltamos
    }
  }
  return out;
}

function typeMatches(node: any): boolean {
  const t = node?.["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && JSONLD_TYPES.has(x.toLowerCase()));
}

function asText(x: any): string | null {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") return x.name ?? x.streetAddress ?? null;
  return null;
}

export type ScrapeSource = {
  /** Construye la URL de búsqueda del directorio. */
  buildUrl: (keyword: string, location: string) => string;
  /** Prefijo del placeId (para deduplicar por fuente). */
  idPrefix: string;
  /** Categoría por defecto si el sector no se detecta. */
  defaultCategory: string;
};

export async function scrapeDirectory(source: ScrapeSource, keyword: string, location: string): Promise<PlacesResult[]> {
  const apiKey = process.env.SCRAPFLY_API_KEY;
  if (!apiKey) {
    throw new Error(`Esta fuente necesita un scraper. Configura SCRAPFLY_API_KEY para activarla.`);
  }
  const url = source.buildUrl(keyword.trim(), location.trim());
  const html = await scrapflyFetch(url, apiKey);
  const nodes = extractJsonLd(html).filter(typeMatches);

  const out: PlacesResult[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const name = String(n?.name ?? "").trim();
    if (!name) continue;
    const phone = (asText(n?.telephone) ?? "").replace(/[^\d+]/g, "") || null;
    const address = asText(n?.address);
    const website = typeof n?.url === "string" && /^https?:/.test(n.url) ? n.url : null;
    const rating = n?.aggregateRating?.ratingValue != null ? Number(n.aggregateRating.ratingValue) : null;
    const reviews = n?.aggregateRating?.reviewCount != null ? Number(n.aggregateRating.reviewCount) : 0;
    const id = `${source.idPrefix}:${(website || phone || name).toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const sector = detectSector({ name, category: source.defaultCategory });
    out.push({
      placeId: id,
      name,
      formattedAddress: address,
      province: location || null,
      types: [`${source.idPrefix}.listing`],
      category: sector ? sector.label : source.defaultCategory,
      latitude: n?.geo?.latitude != null ? Number(n.geo.latitude) : null,
      longitude: n?.geo?.longitude != null ? Number(n.geo.longitude) : null,
      rating: Number.isFinite(rating as number) ? rating : null,
      userRatingCount: Number.isFinite(reviews) ? reviews : 0,
      priceLevel: null,
      businessStatus: "OPERATIONAL",
      gmbUrl: website,
      website,
      phone,
      internationalPhone: phone,
      rawData: { source: source.idPrefix, sector: sector?.key ?? null, raw: { name, phone, address } }
    });
  }
  return out;
}
