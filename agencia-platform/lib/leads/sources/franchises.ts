/**
 * Fuente "franquicias" (enfocada a la CENTRAL, no al franquiciado).
 *
 * Idea: captar la CENTRAL de una franquicia ofreciéndole gestionar las fichas de
 * Google (GMB) de TODA su red desde una sola plataforma (GMB HUB de Negocio Vivo):
 * detectar reseñas negativas al momento, responderlas, y mantener un estilo
 * uniforme en todas las fichas. El gancho es un INFORME de "salud de red": se
 * muestrea Google Maps de la marca y se cuantifica la INCOHERENCIA entre locales
 * (unos con 4,8★ y otros con 2,9★, unos con web y otros sin nada…), que es justo
 * el dolor que GMB HUB resuelve de forma centralizada.
 *
 * Flujo: nicho → IA propone marcas (VERIFICADAS contra Places, sin inventar) →
 * el usuario elige → se analiza la red de cada una → informe + email a la central.
 */

import { completeJson } from "@/lib/ai/anthropic";
import { placesTextSearch, type PlacesResult } from "../google-places";
import { extractEmailsFromWebsite } from "../email-extract";

function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const BRANDS_SCHEMA = {
  type: "object",
  properties: { brands: { type: "array", items: { type: "string" } } },
  required: ["brands"]
};

/**
 * Propone marcas de franquicia REALES de un nicho y las VERIFICA contra Places
 * (que existan como cadena con varios locales). Devuelve solo las verificadas,
 * con cuántas fichas se han visto en la muestra.
 */
export async function discoverFranchiseBrands(
  workspaceId: string,
  niche: string
): Promise<{ brands: { name: string; sampleCount: number }[] }> {
  let proposed: string[] = [];
  try {
    const res = await completeJson<{ brands?: string[] }>({
      workspaceId,
      model: "claude-haiku-4-5-20251001",
      system:
        "Devuelve marcas de FRANQUICIA reales que operan en ESPAÑA en el nicho indicado, con red de varios locales. Solo nombres de marca reales y actuales, NO inventes. Máximo 18. Devuelve SOLO el JSON {brands:[...]}.",
      user: `Nicho: ${niche}\n\nMarcas de franquicia en España de ese nicho:`,
      schema: BRANDS_SCHEMA,
      maxTokens: 400
    });
    proposed = Array.isArray(res?.brands) ? res.brands.filter((b) => typeof b === "string" && b.trim()).map((b) => b.trim()) : [];
  } catch {
    proposed = [];
  }
  // Dedup por slug.
  const seen = new Set<string>();
  proposed = proposed.filter((b) => { const k = slug(b); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 18);

  // Verificación: la marca debe aparecer como cadena (≥3 fichas) en Places.
  const verified: { name: string; sampleCount: number }[] = [];
  for (const name of proposed) {
    try {
      const hits = await placesTextSearch({ workspaceId, query: name, maxPages: 1, pageSize: 20 });
      // Cuenta fichas cuyo nombre contiene la marca completa (evita falsos positivos).
      const nslug = slug(name);
      const count = hits.filter((h) => slug(h.name).includes(nslug)).length;
      if (count >= 3) verified.push({ name, sampleCount: count });
    } catch {
      // sin key de Places / error → saltar
    }
  }
  return { brands: verified };
}

export type NetworkMetrics = {
  sampled: number;
  avgRating: number | null;
  minRating: number | null;
  maxRating: number | null;
  ratingSpread: number | null; // max - min
  lowRatingPct: number; // % de locales ≤ 3,5★ (con ≥5 reseñas)
  noWebsitePct: number; // % sin web
  noReviewsPct: number; // % con < 5 reseñas (casi invisibles)
  closedPct: number; // % no operativos
  reviewsMin: number;
  reviewsMax: number;
};

function computeMetrics(locs: PlacesResult[]): NetworkMetrics {
  const n = locs.length;
  const ratings = locs.map((l) => l.rating).filter((r): r is number => typeof r === "number");
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const min = ratings.length ? Math.min(...ratings) : null;
  const max = ratings.length ? Math.max(...ratings) : null;
  const reviews = locs.map((l) => l.userRatingCount ?? 0);
  const pct = (c: number) => (n ? Math.round((c / n) * 100) : 0);
  return {
    sampled: n,
    avgRating: avg != null ? Math.round(avg * 100) / 100 : null,
    minRating: min,
    maxRating: max,
    ratingSpread: min != null && max != null ? Math.round((max - min) * 100) / 100 : null,
    lowRatingPct: pct(locs.filter((l) => l.rating != null && l.rating <= 3.5 && (l.userRatingCount ?? 0) >= 5).length),
    noWebsitePct: pct(locs.filter((l) => !l.website).length),
    noReviewsPct: pct(locs.filter((l) => (l.userRatingCount ?? 0) < 5).length),
    closedPct: pct(locs.filter((l) => l.businessStatus && l.businessStatus !== "OPERATIONAL").length),
    reviewsMin: reviews.length ? Math.min(...reviews) : 0,
    reviewsMax: reviews.length ? Math.max(...reviews) : 0
  };
}

/** Informe de salud de red en texto (determinista, con las cifras reales). */
function buildReport(brand: string, m: NetworkMetrics): string {
  const lines = [
    `Análisis de red — ${brand}`,
    `Muestra analizada: ${m.sampled} fichas de Google.`,
    m.avgRating != null ? `Valoración media: ${m.avgRating}★ (de ${m.minRating}★ a ${m.maxRating}★).` : `Sin valoraciones suficientes.`,
    m.ratingSpread != null && m.ratingSpread >= 1 ? `⚠️ Dispersión alta: ${m.ratingSpread} puntos entre el mejor y el peor local — la experiencia de marca no es homogénea.` : null,
    m.lowRatingPct > 0 ? `⚠️ ${m.lowRatingPct}% de los locales están en 3,5★ o menos: dañan la reputación de toda la marca.` : null,
    m.noWebsitePct > 0 ? `⚠️ ${m.noWebsitePct}% de las fichas no enlazan web: pierden tráfico y conversión.` : null,
    m.noReviewsPct > 0 ? `⚠️ ${m.noReviewsPct}% tienen muy pocas reseñas: casi invisibles en su zona.` : null,
    m.closedPct > 0 ? `⚠️ ${m.closedPct}% figuran como no operativos en Google (fichas desactualizadas).` : null,
    `Reseñas por local: de ${m.reviewsMin} a ${m.reviewsMax} — señal de que cada local gestiona (o no) su ficha por su cuenta.`
  ].filter(Boolean);
  return lines.join("\n");
}

const EMAIL_SCHEMA = { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"] };

const FRANCHISE_SYSTEM = `Eres un consultor de Negocio Vivo. Escribes al RESPONSABLE DE MARKETING / EXPANSIÓN de la CENTRAL de
una franquicia para ofrecerle gestionar las fichas de Google (Google Business Profile) de TODA su red desde una
sola plataforma con IA (producto "GMB HUB"): detectar reseñas negativas al instante y responderlas, mantener un
ESTILO UNIFORME en todas las fichas y en las respuestas, y monitorizar la salud de la red local por local.
Redacta un EMAIL frío B2B, español de España, trato de usted consistente, profesional y directo:
- Asunto corto y concreto. Cuerpo de 6-8 líneas.
- Apóyate en los DATOS del análisis de red que te paso (dispersión de valoraciones, locales bajos, fichas sin web…)
  para evidenciar el problema de INCOHERENCIA DE MARCA entre locales, SIN inventar cifras que no estén en el análisis.
- El foco es de MARCA y CONTROL centralizado (una red incoherente daña la reputación global), no captación local suelta.
- Cierre con propuesta de enviar el informe completo de su red y una llamada de 15 min.
- No inventes datos, clientes ni precios. Devuelve SOLO el JSON {subject, body}.`;

async function writeFranchiseEmail(workspaceId: string, brand: string, report: string): Promise<{ subject: string; body: string }> {
  return completeJson<{ subject: string; body: string }>({
    workspaceId,
    model: "claude-haiku-4-5-20251001",
    system: FRANCHISE_SYSTEM,
    user: `Franquicia (central): ${brand}\n\nAnálisis de su red (usa estas cifras, no inventes otras):\n${report}\n\nEscribe el email al responsable de marketing/expansión de la central:`,
    schema: EMAIL_SCHEMA,
    maxTokens: 700
  });
}

/** Dominio web más frecuente de la muestra (el corporativo de la marca). */
function modalWebsite(locs: PlacesResult[]): string | null {
  const freq = new Map<string, number>();
  for (const l of locs) {
    if (!l.website) continue;
    try {
      const host = new URL(l.website).hostname.replace(/^www\./, "");
      freq.set(host, (freq.get(host) ?? 0) + 1);
    } catch { /* url inválida */ }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [host, n] of freq) if (n > bestN) { best = host; bestN = n; }
  return best ? `https://${best}` : null;
}

/**
 * Analiza la red de UNA marca: muestrea sus fichas en Google, calcula métricas de
 * salud, genera el informe y el email, extrae el email corporativo de su web, y
 * devuelve un "lead central" (PlacesResult) listo para persistir + el email.
 */
export async function analyzeFranchiseNetwork(
  workspaceId: string,
  brand: string,
  location?: string
): Promise<{ central: PlacesResult; metrics: NetworkMetrics; report: string; email: string | null; subject?: string; body?: string } | null> {
  const query = location && location.trim() ? `${brand} ${location.trim()}` : brand;
  let locs: PlacesResult[] = [];
  try {
    locs = await placesTextSearch({ workspaceId, query, maxPages: 3, pageSize: 20 });
  } catch {
    return null;
  }
  const nslug = slug(brand);
  locs = locs.filter((l) => slug(l.name).includes(nslug));
  if (locs.length < 3) return null;

  const metrics = computeMetrics(locs);
  const report = buildReport(brand, metrics);
  const site = modalWebsite(locs);
  let email: string | null = null;
  if (site) {
    try { const emails = await extractEmailsFromWebsite(site); email = emails[0] ?? null; } catch { email = null; }
  }
  let subject: string | undefined;
  let body: string | undefined;
  try {
    const mail = await writeFranchiseEmail(workspaceId, brand, report);
    subject = mail.subject;
    body = mail.body;
  } catch { /* si la IA falla, se persiste el lead sin borrador */ }

  const central: PlacesResult = {
    placeId: `franchise:${slug(brand)}`,
    name: brand,
    formattedAddress: null,
    province: location?.trim() || "España",
    types: ["franchise.central"],
    category: "Central de franquicia",
    latitude: null,
    longitude: null,
    rating: metrics.avgRating,
    userRatingCount: 0,
    priceLevel: null,
    businessStatus: "OPERATIONAL",
    gmbUrl: null,
    website: site,
    phone: null,
    internationalPhone: null,
    rawData: {
      source: "franchises",
      brand,
      metrics,
      // El informe se muestra en la tarjeta de revisión (campo jobDescription).
      jobDescription: report,
      reportText: report,
      email: email ?? undefined
    }
  };
  return { central, metrics, report, email, subject, body };
}
