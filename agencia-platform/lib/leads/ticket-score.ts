/**
 * Ticket score: estima el VALOR de un lead (cuánto puede pagar / LTV), distinto
 * del scorer de "dolor ahora" (scorer.ts, que premia rating bajo y ficha
 * dormida). Aquí premiamos lo contrario: sector de alto valor, que YA invierta
 * en marketing (anuncios), precio €€€, tamaño y sofisticación.
 *
 * Sin IA ni dependencias: reglas + diccionario de sectores. 0-100 + tier.
 */

export type TicketTier = "premium" | "alto" | "medio" | "bajo";

type SectorDef = { key: string; label: string; tier: Exclude<TicketTier, "bajo">; keywords: string[] };

/**
 * Diccionario de sectores por valor de cliente. El `tier` marca cuánto suele
 * valer un cliente del sector (premium = miles de € por cliente). Las keywords
 * se buscan SIN acentos en nombre + categoría + tipos del negocio.
 */
export const HIGH_VALUE_SECTORS: SectorDef[] = [
  {
    key: "dental",
    label: "Clínica dental",
    tier: "premium",
    keywords: ["dental", "dentista", "odontolog", "ortodonc", "implant", "endodonc"]
  },
  {
    key: "estetica_medica",
    label: "Medicina estética / cirugía",
    tier: "premium",
    keywords: ["estetic", "cirug", "capilar", "injerto", "depilacion laser", "medicina estetica", "botox", "rejuven"]
  },
  {
    key: "salud_privada",
    label: "Clínica / sanidad privada",
    tier: "premium",
    keywords: ["clinica", "hospital", "oftalmolog", "fertilidad", "reproduccion asistida", "ginecolog", "traumatolog", "fisioterap premium"]
  },
  {
    key: "legal",
    label: "Abogados / despacho",
    tier: "premium",
    keywords: ["abogad", "bufete", "despacho juridic", "procurador", "notaria", "asesoria juridica", "graduado social"]
  },
  {
    key: "inmobiliaria",
    label: "Inmobiliaria / promotora",
    tier: "premium",
    keywords: ["inmobiliar", "real estate", "promotora", "promociones inmobil", "api ", "agencia inmobil"]
  },
  {
    key: "automocion",
    label: "Concesionario / automoción",
    tier: "premium",
    keywords: ["concesionario", "automocion", "vehiculos", "motor ", "ocasion km0", "talleres oficial"]
  },
  {
    key: "reformas",
    label: "Reformas / construcción",
    tier: "alto",
    keywords: ["reforma", "construc", "obra", "arquitect", "interioris", "carpinteria aluminio", "promociones"]
  },
  {
    key: "salud",
    label: "Salud / paramédico",
    tier: "alto",
    keywords: ["fisioterap", "podolog", "veterinar", "optic", "audiolog", "nutricion", "psicolog", "logopeda"]
  },
  {
    key: "formacion",
    label: "Formación / academia",
    tier: "alto",
    keywords: ["academia", "autoescuela", "formacion", "escuela de", "oposiciones", "idiomas centro"]
  },
  {
    key: "wellness",
    label: "Gimnasio / wellness",
    tier: "alto",
    keywords: ["gimnasio", "fitness", "crossfit", "spa", "balneario", "centro de bienestar", "pilates"]
  },
  {
    key: "eventos",
    label: "Eventos / hostelería premium",
    tier: "alto",
    keywords: ["catering", "finca de eventos", "salon de bodas", "wedding", "banquetes", "hotel "]
  },
  {
    key: "hogar",
    label: "Servicios para el hogar",
    tier: "medio",
    keywords: ["fontaner", "electricist", "climatizacion", "aire acondicionado", "pintor", "cerrajer", "mudanzas", "jardiner"]
  },
  {
    key: "belleza",
    label: "Belleza / cuidado personal",
    tier: "medio",
    keywords: ["peluqueria", "barberia", "centro de estetica", "uñas", "manicura", "tattoo", "tatuaje", "micropigment"]
  }
];

const TIER_PTS: Record<SectorDef["tier"], number> = { premium: 45, alto: 30, medio: 15 };

/** Normaliza a minúsculas y sin acentos para matchear keywords. */
function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Detecta el sector de alto valor de un negocio por su nombre/categoría/tipos. */
export function detectSector(parts: { name?: string | null; category?: string | null; types?: string[] | null }): SectorDef | null {
  const hay = norm([parts.name, parts.category, ...(parts.types ?? [])].filter(Boolean).join(" · "));
  for (const sec of HIGH_VALUE_SECTORS) {
    if (sec.keywords.some((k) => hay.includes(k))) return sec;
  }
  return null;
}

export type TicketInput = {
  name?: string | null;
  category?: string | null;
  types?: string[] | null;
  priceLevel?: number | null;
  reviewsCount?: number | null;
  website?: string | null;
  /** ¿El negocio ya invierte en anuncios? (Meta Ad Library, etc.) Señal nº1. */
  runsAds?: boolean | null;
  /** ¿Cadena / varios locales con el mismo nombre? Más presupuesto. */
  multiLocation?: boolean | null;
};

export type TicketResult = {
  ticketScore: number; // 0-100
  ticketTier: TicketTier;
  sector: string | null; // label del sector detectado
  breakdown: { signal: string; pts: number; note: string }[];
};

export function scoreTicket(input: TicketInput): TicketResult {
  const b: TicketResult["breakdown"] = [];
  let total = 0;

  // Sector de alto valor 0-45 (la señal que más manda).
  const sec = detectSector(input);
  const secPts = sec ? TIER_PTS[sec.tier] : 0;
  total += secPts;
  b.push({ signal: "sector", pts: secPts, note: sec ? `${sec.label} (${sec.tier})` : "Sector no premium" });

  // Ya invierte en marketing 0-25 (señal nº1 de presupuesto + apertura).
  const adsPts = input.runsAds ? 25 : 0;
  if (adsPts) b.push({ signal: "runs_ads", pts: adsPts, note: "Ya hace anuncios → presupuesto" });
  total += adsPts;

  // Multi-local 0-10.
  const multiPts = input.multiLocation ? 10 : 0;
  if (multiPts) b.push({ signal: "multi_location", pts: multiPts, note: "Cadena / varios locales" });
  total += multiPts;

  // Precio €€€ 0-12.
  const pl = input.priceLevel ?? 0;
  const plPts = pl >= 4 ? 12 : pl === 3 ? 9 : pl === 2 ? 4 : 0;
  if (plPts) b.push({ signal: "price_level", pts: plPts, note: `Precio ${"€".repeat(pl)}` });
  total += plPts;

  // Tamaño por volumen de reseñas 0-10 (proxy de facturación).
  const cnt = input.reviewsCount ?? 0;
  const cntPts = cnt > 300 ? 10 : cnt >= 100 ? 7 : cnt >= 30 ? 4 : 0;
  if (cntPts) b.push({ signal: "size", pts: cntPts, note: `${cnt} reseñas (tamaño)` });
  total += cntPts;

  // Sofisticación: tiene web 0-8.
  const webPts = input.website && input.website.trim() ? 8 : 0;
  if (webPts) b.push({ signal: "website", pts: webPts, note: "Tiene web" });
  total += webPts;

  total = Math.max(0, Math.min(100, total));
  const ticketTier: TicketTier = total >= 70 ? "premium" : total >= 45 ? "alto" : total >= 25 ? "medio" : "bajo";

  return { ticketScore: total, ticketTier, sector: sec?.label ?? null, breakdown: b };
}
