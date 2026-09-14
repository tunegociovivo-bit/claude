/**
 * Buscador Inmobiliario — motor de búsqueda + análisis de inversión.
 *
 * Flujo en dos fases:
 *   1) INVESTIGACIÓN: Claude con la herramienta nativa de búsqueda web
 *      (web_search) rastrea los portales seleccionados (Aliseda, Solvia,
 *      Gia, Trial3, Ikesa…) buscando propiedades que encajen con los
 *      criterios del usuario y recopila datos reales (precio, superficie,
 *      ubicación, enlace, si está ocupada, precio de mercado de la zona…).
 *   2) ANÁLISIS: con la investigación recopilada, Claude puntúa cada
 *      propiedad (0-100), calcula rentabilidad estimada y decide si es una
 *      OPORTUNIDAD de inversión, devolviendo JSON estructurado.
 */

import { getAnthropicForWorkspace, completeJson, DEFAULT_MODEL } from "@/lib/ai/anthropic";
import { logAiUsage } from "@/lib/ai/usage";
import {
  EVIDENCE_FIELDS,
  OPPORTUNITY_SCHEMA as BUSINESS_OPPORTUNITY_SCHEMA,
  REQUIRED_SPACE_LABELS,
  type BusinessPremisesSearch,
  type EvidenceField,
  type PortalCoverage,
  type RequiredSpace
} from "./contracts";
import { matchAndRankOpportunities } from "./matching";
import { portalsByKeys, type Portal } from "./portals";

// Modelo para la fase de investigación con búsqueda web. Usamos el modelo
// estándar del workspace para mantener consistencia con el resto de la app.
const RESEARCH_MODEL = DEFAULT_MODEL;

export type OccupancyFilter = "any" | "occupied" | "free";

export type SearchParams = {
  location: string;
  operation: "rent" | "sale" | "both";
  businessDescription?: string;
  propertyType?: string;
  objective?: string; // alquiler | reventa | vivienda
  /** Estado de ocupación buscado: indiferente, con okupas dentro, o libre/desocupada */
  occupancy?: OccupancyFilter;
  minPrice?: number;
  maxPrice?: number;
  minSurface?: number;
  maxSurface?: number;
  minCabins: number;
  allowOpenPlan: boolean;
  preferStreetLevel: boolean;
  preferSingleFloor: boolean;
  basementPolicy: "allow_penalize" | "exclude";
  requiredSpaces: RequiredSpace[];
  distributionNotes?: string;
  maxMonthlyRent?: number;
  maxPurchasePrice?: number;
  maxFitOutBudget?: number;
  maxInitialInvestment?: number;
  preferReadyToEnter: boolean;
  portals: string[];
  maxResults: number;
  onlyMatches: boolean;
};

export type Opportunity = {
  id: string;
  portal: string;
  portal_label: string;
  bank: string;
  title: string;
  property_type: string;
  location: string;
  url: string;
  url_verified: boolean;
  price: number;
  surface: number | null;
  price_m2: number | null;
  estimated_market_price: number | null;
  discount_pct: number | null;
  estimated_rent: number | null;
  gross_yield: number | null;
  score: number;
  verdict: "OPORTUNIDAD" | "INTERESANTE" | "DESCARTAR";
  occupied: boolean;
  pros: string[];
  cons: string[];
  reasoning: string;
  /** Teléfono de contacto extraído de la ficha (si está disponible). */
  phone?: string;
  /** Enlace de respaldo (búsqueda en el portal) cuando no hay URL directa
   *  verificada de la ficha. Lo calcula el servidor, no la IA. */
  searchUrl?: string;
  operation: "rent" | "sale" | "both" | "transfer" | "unknown";
  monthly_rent: number | null;
  sale_price: number | null;
  transfer_price: number | null;
  existing_cabins: number | null;
  cabin_capacity: number | null;
  layout: "open_plan" | "partitioned" | "mixed" | "unknown";
  floor: "street" | "basement" | "mezzanine" | "upper" | "mixed" | "unknown";
  single_floor: boolean | null;
  has_basement: boolean | null;
  spaces: Record<RequiredSpace, boolean | null>;
  condition: "ready" | "minor_works" | "major_works" | "unknown";
  fit_out_estimate: { min: number; max: number } | null;
  initial_investment: {
    confirmedLowerBound: number;
    estimatedMin: number | null;
    estimatedMax: number | null;
    complete: boolean;
  };
  evidence: Array<{ field: EvidenceField; status: "confirmed" | "inferred" | "conflicting" | "unknown"; text: string }>;
  unknown_fields: string[];
  fit_breakdown: Array<{ key: string; label: string; status: "match" | "partial" | "mismatch" | "unknown" | "not_applicable"; points: number; maxPoints: number; reason: string }>;
  fit_confidence: number;
  sources: Array<{ portal: string; label: string; url: string; reference: string | null }>;
};

const EVIDENCE_FIELD_SET = new Set<string>(EVIDENCE_FIELDS);
const EVIDENCE_STATUS_SET = new Set(["confirmed", "inferred", "conflicting", "unknown"] as const);

function hasStructuredValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "" || value === "unknown") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasStructuredValue);
  return true;
}

function normalizeEvidence(
  rawEvidence: unknown,
  values: Partial<Record<EvidenceField, unknown>>
): Opportunity["evidence"] {
  const evidence: Opportunity["evidence"] = [];
  if (Array.isArray(rawEvidence)) {
    for (const item of rawEvidence) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Record<string, unknown>;
      if (
        typeof candidate.field !== "string" ||
        !EVIDENCE_FIELD_SET.has(candidate.field) ||
        typeof candidate.status !== "string" ||
        !EVIDENCE_STATUS_SET.has(candidate.status as "confirmed" | "inferred" | "conflicting" | "unknown")
      ) continue;
      evidence.push({
        field: candidate.field as EvidenceField,
        status: candidate.status as Opportunity["evidence"][number]["status"],
        text: typeof candidate.text === "string" ? candidate.text : ""
      });
    }
  }
  for (const [field, value] of Object.entries(values) as Array<[EvidenceField, unknown]>) {
    if (hasStructuredValue(value) && !evidence.some((item) => item.field === field)) {
      evidence.push({ field, status: "inferred", text: "Dato estructurado sin evidencia literal asociada" });
    }
  }
  return evidence;
}

export type SearchResult = {
  opportunities: Opportunity[];
  summary: string;
  searchedPortals: { key: string; label: string; bank: string }[];
  portalCoverage: PortalCoverage[];
  stats: { candidatesFound: number; duplicatesMerged: number; hardFiltered: number; returned: number };
  notes?: string;
};

function buildResearchPrompt(params: SearchParams, portals: Portal[]): string {
  const lines: string[] = [];
  lines.push(
    "Eres un consultor inmobiliario especializado en encontrar locales comerciales viables para abrir negocios en España."
  );
  lines.push(
    "Busca anuncios REALES y VIGENTES de locales comerciales exclusivamente en los portales configurados que figuran a continuación."
  );
  portals.forEach((p) => {
    lines.push(
      `- ${p.label} (${p.bank}) → ${p.url}${p.note ? ` — ${p.note}` : ""}`
    );
  });
  lines.push("");
  lines.push("REQUISITOS DUROS (si el dato está publicado):");
  lines.push(`- Zona: ${params.location}`);
  lines.push(`- Operación: ${params.operation === "rent" ? "alquiler" : params.operation === "sale" ? "venta" : "alquiler o venta"}`);
  lines.push("- Tipo: local comercial apto o potencialmente apto para actividad empresarial.");
  if (params.minSurface || params.maxSurface) {
    lines.push(`- Superficie: ${params.minSurface ?? "sin mínimo"} a ${params.maxSurface ?? "sin máximo"} m².`);
  }
  if (params.maxMonthlyRent !== undefined) lines.push(`- Renta mensual máxima: ${params.maxMonthlyRent} €/mes.`);
  if (params.maxPurchasePrice !== undefined) lines.push(`- Precio de compra máximo: ${params.maxPurchasePrice} €.`);
  if (params.maxFitOutBudget !== undefined) lines.push(`- Presupuesto máximo de adecuación: ${params.maxFitOutBudget} €.`);
  if (params.maxInitialInvestment !== undefined) lines.push(`- Inversión inicial máxima: ${params.maxInitialInvestment} €.`);
  lines.push("");
  lines.push("NECESIDADES Y PREFERENCIAS PARA EL RANKING:");
  if (params.businessDescription) lines.push(`- Negocio / actividad: ${params.businessDescription}`);
  if (params.minCabins > 0) {
    lines.push(`- Debe poder albergar al menos ${params.minCabins} cabinas. No es obligatorio que ya existan: ${params.allowOpenPlan ? "un local diáfano es válido si su forma y superficie permiten crearlas" : "se valora que ya esté compartimentado"}.`);
  }
  if (params.requiredSpaces.length) {
    lines.push(`- Espacios necesarios: ${params.requiredSpaces.map((key) => REQUIRED_SPACE_LABELS[key]).join(", ")}. Pueden existir ya o ser viables tras una obra razonable.`);
  }
  if (params.distributionNotes) lines.push(`- Notas de distribución: ${params.distributionNotes}`);
  if (params.preferStreetLevel) lines.push("- Preferencia: planta calle.");
  if (params.preferSingleFloor) lines.push("- Preferencia: todo en una misma planta.");
  if (params.basementPolicy === "exclude") {
    lines.push("- Excluir locales situados únicamente en sótano.");
  } else {
    lines.push("- No excluir automáticamente un local con sótano; señala el riesgo de licencia, accesibilidad y sobrecoste de obra.");
  }
  if (params.preferReadyToEnter) {
    lines.push("- Prioriza un local listo o casi listo aunque la renta sea algo mayor, si reduce claramente la obra y la inversión inicial total.");
  }
  lines.push("");
  lines.push("INSTRUCCIONES:");
  lines.push(
    "1. Busca en CADA portal anterior usando sus dominios (" +
      portals.map((p) => p.domain).join(", ") +
      "). Prueba local comercial, alquiler/venta, barrios y distritos de la zona."
  );
  lines.push(
    "2. Para cada anuncio recopila: portal y referencia, operación, dirección, renta mensual o precio de venta, traspaso si lo hay, superficie, planta/niveles/sótano, distribución, cabinas existentes y capacidad estimada, estado, accesibilidad, baños y cualquier coste de adecuación mencionado."
  );
  lines.push(
    "3. El enlace debe ser la URL exacta de la ficha individual. Si no la tienes, deja el enlace vacío; no inventes una ruta ni uses la home o un listado."
  );
  lines.push(
    "4. Distingue siempre lo que el anuncio confirma de lo que solo puede inferirse. Usa 'desconocido' cuando no haya evidencia y no inventes plantas, cabinas, licencias ni costes."
  );
  lines.push(
    "5. Incluye locales diáfanos y opciones con datos incompletos si pueden encajar; el servidor aplicará después filtros deterministas solo sobre datos confirmados."
  );
  lines.push(
    "6. Devuelve un informe compacto con todos los anuncios encontrados, uno por uno, y sus evidencias."
  );
  return lines.join("\n");
}

type ResearchResult = { research: string; coverage: PortalCoverage[] };

/** Investiga un lote pequeño para que cada portal reciba búsquedas reales. */
async function researchPortalBatch(
  workspaceId: string,
  userId: string | null,
  params: SearchParams,
  portals: Portal[]
): Promise<string> {
  const client = await getAnthropicForWorkspace(workspaceId);
  const allowedDomains = portals.map((p) => p.domain);

  // Solo búsqueda web (generación probada). No usamos web_fetch: abrir las
  // páginas completas es lento y hacía que la petición superara el tiempo
  // límite del servidor (timeout → "Error en la búsqueda"). Para acotar el
  // enlace a la ficha nos apoyamos en el prompt + saneo de URLs.
  const WEB_SEARCH_TOOL: any = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 7,
    allowed_domains: allowedDomains
  };

  const messages: any[] = [
    { role: "user", content: buildResearchPrompt(params, portals) }
  ];

  let totalIn = 0;
  let totalOut = 0;

  async function create(): Promise<any> {
    return client.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 7000,
      tools: [WEB_SEARCH_TOOL] as any,
      messages
    });
  }

  let finalText = "";
  for (let i = 0; i < 10; i++) {
    const resp: any = await create();
    totalIn += resp.usage?.input_tokens ?? 0;
    totalOut += resp.usage?.output_tokens ?? 0;

    // La búsqueda web (server tool) pausa el turno; reanudamos.
    if (resp.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: resp.content });
      continue;
    }

    finalText = (resp.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    break;
  }

  logAiUsage({
    workspaceId,
    userId,
    projectId: null,
    feature: "buscador_inmobiliario.research",
    provider: "anthropic",
    model: RESEARCH_MODEL,
    inputTokens: totalIn,
    outputTokens: totalOut
  }).catch(() => {});

  return finalText;
}

/** Fase 1: rastreo por lotes, con un máximo de dos llamadas simultáneas. */
async function researchListings(
  workspaceId: string,
  userId: string | null,
  params: SearchParams,
  portals: Portal[]
): Promise<ResearchResult> {
  const batches: Portal[][] = [];
  for (let i = 0; i < portals.length; i += 4) batches.push(portals.slice(i, i + 4));

  const results: Array<{ batch: Portal[]; status: PromiseSettledResult<string> }> = [];
  for (let i = 0; i < batches.length; i += 2) {
    const pair = batches.slice(i, i + 2);
    const settled = await Promise.allSettled(
      pair.map((batch) => researchPortalBatch(workspaceId, userId, params, batch))
    );
    settled.forEach((status, index) => results.push({ batch: pair[index], status }));
  }

  const research: string[] = [];
  const coverage: PortalCoverage[] = [];
  results.forEach(({ batch, status }) => {
    if (status.status === "fulfilled" && status.value.trim()) {
      research.push(`## LOTE: ${batch.map((portal) => portal.label).join(", ")}\n${status.value}`);
      batch.forEach((portal) => coverage.push({
        key: portal.key,
        label: portal.label,
        status: "searched",
        candidates: 0
      }));
    } else {
      batch.forEach((portal) => coverage.push({
        key: portal.key,
        label: portal.label,
        status: "failed",
        candidates: 0,
        note: "El portal no pudo completarse en este rastreo"
      }));
    }
  });
  return { research: research.join("\n\n"), coverage };
}

const OPPORTUNITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    notes: { type: "string" },
    opportunities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          portal: { type: "string" },
          portal_label: { type: "string" },
          bank: { type: "string" },
          title: { type: "string" },
          property_type: { type: "string" },
          location: { type: "string" },
          url: { type: "string" },
          price: { type: "number" },
          surface: { anyOf: [{ type: "number" }, { type: "null" }] },
          price_m2: { anyOf: [{ type: "number" }, { type: "null" }] },
          estimated_market_price: { anyOf: [{ type: "number" }, { type: "null" }] },
          discount_pct: { anyOf: [{ type: "number" }, { type: "null" }] },
          estimated_rent: { anyOf: [{ type: "number" }, { type: "null" }] },
          gross_yield: { anyOf: [{ type: "number" }, { type: "null" }] },
          score: { type: "number" },
          verdict: { type: "string", enum: ["OPORTUNIDAD", "INTERESANTE", "DESCARTAR"] },
          occupied: { type: "boolean" },
          pros: { type: "array", items: { type: "string" } },
          cons: { type: "array", items: { type: "string" } },
          reasoning: { type: "string" }
        },
        required: [
          "portal",
          "portal_label",
          "bank",
          "title",
          "property_type",
          "location",
          "url",
          "price",
          "surface",
          "price_m2",
          "estimated_market_price",
          "discount_pct",
          "estimated_rent",
          "gross_yield",
          "score",
          "verdict",
          "occupied",
          "pros",
          "cons",
          "reasoning"
        ]
      }
    }
  },
  required: ["summary", "notes", "opportunities"]
};

/**
 * Devuelve la URL solo si parece la ficha de una propiedad concreta.
 * Vacía las URLs que son claramente la home, un listado/búsqueda o una
 * página de paginación del portal (para no enviar al usuario a la página
 * equivocada). Conservador: ante la duda, mantiene la URL.
 */
function isAllowedUrl(url: URL, allowedDomains: string[]): boolean {
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  return allowedDomains.length === 0 ||
    allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function cleanOfferUrl(raw: string | null | undefined, allowedDomains: string[] = []): string {
  const s = (raw || "").trim();
  if (!s) return "";
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return "";
  }
  if (!isAllowedUrl(url, allowedDomains)) return "";
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  // Home del portal (sin ruta).
  if (path === "") return "";
  // Parámetros de paginación / búsqueda.
  const qs = url.search.toLowerCase();
  if (/[?&](page|pagina|pag|p|start|offset|q|query|busqueda|search)=/.test(qs)) return "";
  // Rutas que terminan en una sección de listado genérica (no una ficha).
  const listingTails = [
    "/venta",
    "/comprar",
    "/alquiler",
    "/inmuebles",
    "/viviendas",
    "/propiedades",
    "/resultados",
    "/resultado",
    "/buscador",
    "/buscar",
    "/search",
    "/oportunidades",
    "/inmuebles-en-venta",
    "/listado"
  ];
  if (listingTails.some((t) => path.endsWith(t))) return "";
  return s;
}

/** Convierte HTML a texto plano compacto (quita scripts/estilos/etiquetas). */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&euro;/gi, "€")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Descarga la ficha (petición HTTP rápida con timeout). Devuelve ok=false
 * si: error/timeout, status >= 400, o si tras redirecciones acaba en la
 * home del portal (ficha inexistente → deep-link inventado). Si ok, devuelve
 * también el texto de la página para extraer datos reales (precio, teléfono…).
 */
async function fetchOfferPage(u: string, allowedDomains: string[]): Promise<{ ok: boolean; text: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const orig = new URL(u);
    let current = orig;
    let res: Response | null = null;
    for (let redirect = 0; redirect < 4; redirect++) {
      if (!isAllowedUrl(current, allowedDomains)) {
        clearTimeout(timer);
        return { ok: false, text: "" };
      }
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          accept: "text/html"
        }
      });
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get("location");
      try { await res.body?.cancel(); } catch {}
      if (!location) break;
      current = new URL(location, current);
      res = null;
    }
    if (!res) {
      clearTimeout(timer);
      return { ok: false, text: "" };
    }
    if (!res.ok) {
      clearTimeout(timer);
      try { await res.body?.cancel(); } catch {}
      return { ok: false, text: "" };
    }
    const final = current;
    if (final.pathname.replace(/\/+$/, "") === "" && orig.pathname.replace(/\/+$/, "") !== "") {
      clearTimeout(timer);
      try { await res.body?.cancel(); } catch {}
      return { ok: false, text: "" };
    }
    const raw = await res.text();
    clearTimeout(timer);
    return { ok: true, text: htmlToText(raw).slice(0, 3500) };
  } catch {
    return { ok: false, text: "" };
  }
}

/** Verifica en paralelo las URLs y recoge el texto de las fichas válidas.
 *  Las no verificadas se vacían (la UI usará "Buscar en el portal"). */
async function verifyAndCollectPages(
  opps: Opportunity[],
  portals: Portal[]
): Promise<{ opps: Opportunity[]; pages: Map<number, string> }> {
  opps = opps.map((opportunity) => ({ ...opportunity, url_verified: false }));
  const fetchModeByKey = new Map(portals.map((portal) => [portal.key.toLowerCase(), portal.fetchMode]));
  const fetchModeByLabel = new Map(portals.map((portal) => [portal.label.toLowerCase(), portal.fetchMode]));
  const idxs = opps
    .map((o, i) => {
      const mode = fetchModeByKey.get(o.portal.toLowerCase()) ?? fetchModeByLabel.get(o.portal_label.toLowerCase());
      return o.url && mode !== "search_only" ? i : -1;
    })
    .filter((i) => i >= 0);
  const pages = new Map<number, string>();
  const allowedDomains = portals.map((portal) => portal.domain.toLowerCase());
  const CONCURRENCY = 6;
  for (let i = 0; i < idxs.length; i += CONCURRENCY) {
    const batch = idxs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((idx) => fetchOfferPage(opps[idx].url, allowedDomains)));
    batch.forEach((idx, k) => {
      if (!results[k].ok) opps[idx] = { ...opps[idx], url: "", url_verified: false };
      else {
        opps[idx] = { ...opps[idx], url_verified: true };
        if (results[k].text) pages.set(idx, results[k].text);
      }
    });
  }
  return { opps, pages };
}

const ENRICH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "number" },
          price: { anyOf: [{ type: "number" }, { type: "null" }] },
          monthly_rent: { anyOf: [{ type: "number" }, { type: "null" }] },
          sale_price: { anyOf: [{ type: "number" }, { type: "null" }] },
          phone: { anyOf: [{ type: "string" }, { type: "null" }] },
          surface: { anyOf: [{ type: "number" }, { type: "null" }] },
          address: { anyOf: [{ type: "string" }, { type: "null" }] },
          floor: { type: "string", enum: ["street", "basement", "mezzanine", "upper", "mixed", "unknown"] },
          single_floor: { anyOf: [{ type: "boolean" }, { type: "null" }] },
          has_basement: { anyOf: [{ type: "boolean" }, { type: "null" }] },
          existing_cabins: { anyOf: [{ type: "number" }, { type: "null" }] },
          layout: { type: "string", enum: ["open_plan", "partitioned", "mixed", "unknown"] },
          condition: { type: "string", enum: ["ready", "minor_works", "major_works", "unknown"] }
        },
        required: [
          "index", "price", "monthly_rent", "sale_price", "phone", "surface", "address", "floor",
          "single_floor", "has_basement", "existing_cabins", "layout", "condition"
        ]
      }
    }
  },
  required: ["items"]
};

/** Extrae datos reales (precio, teléfono, superficie, dirección) del texto
 *  de las fichas verificadas con UNA sola llamada, y los fusiona. */
async function enrichFromPages(
  workspaceId: string,
  opps: Opportunity[],
  pages: Map<number, string>
): Promise<Opportunity[]> {
  if (pages.size === 0) return opps;
  const blocks = [...pages.entries()].map(
    ([idx, text]) => `### FICHA ${idx}\nURL: ${opps[idx].url}\nTEXTO:\n${text}`
  );
  type EnrichedItem = {
    index: number;
    price: number | null;
    monthly_rent: number | null;
    sale_price: number | null;
    phone: string | null;
    surface: number | null;
    address: string | null;
    floor: Opportunity["floor"];
    single_floor: boolean | null;
    has_basement: boolean | null;
    existing_cabins: number | null;
    layout: Opportunity["layout"];
    condition: Opportunity["condition"];
  };
  let extracted: { items: EnrichedItem[] };
  try {
    extracted = await completeJson({
      workspaceId,
      system:
        "Extraes datos confirmados del texto real de fichas de locales comerciales. Devuelve renta mensual, precio de venta, teléfono, superficie, dirección, planta, si está en una planta, sótano, cabinas existentes, distribución y estado. Usa null o unknown si no aparece de forma explícita. No inventes nada. Responde solo con el JSON del schema.",
      user: blocks.join("\n\n").slice(0, 40000),
      schema: ENRICH_SCHEMA,
      maxTokens: 3000
    });
  } catch {
    return opps; // si la extracción falla, seguimos con los datos de la IA
  }
  for (const it of extracted.items ?? []) {
    const o = opps[it.index];
    if (!o) continue;
    const next = { ...o };
    if (typeof it.price === "number" && it.price > 0) next.price = it.price;
    if (typeof it.monthly_rent === "number" && it.monthly_rent > 0) next.monthly_rent = it.monthly_rent;
    if (typeof it.sale_price === "number" && it.sale_price > 0) next.sale_price = it.sale_price;
    if (it.phone && it.phone.trim()) next.phone = it.phone.trim();
    if (typeof it.surface === "number" && it.surface > 0) next.surface = it.surface;
    if (it.address && it.address.trim() && (!next.location || next.location.length < 4))
      next.location = it.address.trim();
    if (it.floor !== "unknown") next.floor = it.floor;
    if (typeof it.single_floor === "boolean") next.single_floor = it.single_floor;
    if (typeof it.has_basement === "boolean") next.has_basement = it.has_basement;
    if (typeof it.existing_cabins === "number" && it.existing_cabins >= 0) next.existing_cabins = it.existing_cabins;
    if (it.layout !== "unknown") next.layout = it.layout;
    if (it.condition !== "unknown") next.condition = it.condition;
    const confirmedCandidates: Array<[EvidenceField, unknown]> = [
      ["monthly_rent", it.monthly_rent], ["sale_price", it.sale_price], ["surface", it.surface],
      ["floor", it.floor === "unknown" ? null : it.floor], ["single_floor", it.single_floor],
      ["has_basement", it.has_basement], ["existing_cabins", it.existing_cabins],
      ["layout", it.layout === "unknown" ? null : it.layout],
      ["condition", it.condition === "unknown" ? null : it.condition]
    ];
    const confirmed = confirmedCandidates.filter(([, value]) => value !== null && value !== undefined);
    next.evidence = [
      ...(next.evidence ?? []).filter((item) => !confirmed.some(([field]) => field === item.field)),
      ...confirmed.map(([field, value]) => ({
        field,
        status: "confirmed" as const,
        text: `Dato verificado en la ficha: ${String(value)}`
      }))
    ];
    // Recalcular métricas derivadas con el precio real.
    if (next.price > 0) {
      if (next.surface && next.surface > 0) next.price_m2 = Math.round(next.price / next.surface);
      if (next.estimated_market_price && next.estimated_market_price > 0)
        next.discount_pct = Math.round((1 - next.price / next.estimated_market_price) * 100);
      if (next.estimated_rent && next.estimated_rent > 0)
        next.gross_yield = Math.round(((next.estimated_rent * 12) / next.price) * 1000) / 10;
    }
    opps[it.index] = next;
  }
  return opps;
}

/** Fase 2: estructurar y puntuar las oportunidades. */
async function analyzeListings(
  workspaceId: string,
  research: string,
  params: SearchParams,
  portals: Portal[],
  coverage: PortalCoverage[]
): Promise<SearchResult> {
  const system = [
    "Eres un analista de locales comerciales. Convierte una investigación web en datos estructurados, sin inventar anuncios ni atributos.",
    "Incluye TODOS los anuncios que aparezcan en la investigación. La puntuación final la calculará el servidor: devuelve score=0 y verdict='DESCARTAR' como valores provisionales.",
    "Usa operation=rent/sale/both/transfer/unknown. monthly_rent es la renta anunciada al mes; sale_price es el precio de venta; transfer_price es el traspaso. Usa null si no aparece.",
    "Cabinas existentes y capacidad de cabinas son conceptos distintos. Un local open_plan puede tener existing_cabins=0 y cabin_capacity estimada si la superficie y geometría lo justifican.",
    "floor indica street/basement/mezzanine/upper/mixed/unknown; single_floor y has_basement usan null si no están claros. Completa todas las claves de spaces con true/false/null.",
    "condition debe ser ready, minor_works, major_works o unknown. fit_out_estimate solo puede ser un rango conservador; usa null si faltan datos para estimarlo.",
    "En evidence incluye la evidencia breve de cada dato importante y marca confirmed solo cuando el anuncio lo dice expresamente; inferred cuando es una inferencia; conflicting si hay contradicción; unknown si falta.",
    `En evidence.field usa únicamente estas claves exactas: ${EVIDENCE_FIELDS.join(", ")}.`,
    "unknown_fields enumera los datos relevantes ausentes. Máximo 3 pros, 3 cons y dos frases de reasoning por local.",
    "URL solo puede ser la ficha individual exacta. Si solo hay home, listado o URL dudosa, deja url vacía.",
    "Responde SIEMPRE en español."
  ].join("\n");

  const user = [
    buildResearchPrompt(params, portals),
    "",
    "INVESTIGACIÓN RECOPILADA:",
    research || "(sin resultados)"
  ].join("\n");

  type AnalysisData = { summary: string; notes: string; opportunities: Opportunity[] };
  let data: AnalysisData;
  try {
    data = await completeJson<AnalysisData>({
      workspaceId,
      system,
      user,
      schema: BUSINESS_OPPORTUNITY_SCHEMA,
      maxTokens: 12000
    });
  } catch (e: any) {
    // Si la respuesta se cortó por longitud (muchas propiedades) o el JSON
    // vino mal, reintentamos UNA vez pidiendo máxima brevedad para que quepan
    // todas, en vez de devolver un error al usuario.
    const msg = String(e?.message ?? e);
    if (/truncad|max_tokens|JSON|Unterminated|inválido/i.test(msg)) {
      data = await completeJson<AnalysisData>({
        workspaceId,
        system:
          system +
          "\nSÉ AÚN MÁS BREVE: máximo 2 pros y 2 cons de 3-4 palabras y un 'reasoning' de una sola frase corta, para que TODAS las propiedades quepan en la respuesta sin cortarse.",
        user,
        schema: BUSINESS_OPPORTUNITY_SCHEMA,
        maxTokens: 12000
      });
    } else {
      throw e;
    }
  }

  let opps: Opportunity[] = (Array.isArray(data.opportunities) ? data.opportunities : []).map((raw) => {
    const monthlyRent = typeof raw.monthly_rent === "number" ? raw.monthly_rent : null;
    const salePrice = typeof raw.sale_price === "number" ? raw.sale_price : null;
    const transferPrice = typeof raw.transfer_price === "number" ? raw.transfer_price : null;
    const fitOut = raw.fit_out_estimate &&
      Number.isFinite(raw.fit_out_estimate.min) && Number.isFinite(raw.fit_out_estimate.max)
      ? { min: Math.max(0, raw.fit_out_estimate.min), max: Math.max(raw.fit_out_estimate.min, raw.fit_out_estimate.max) }
      : null;
    const evidence = normalizeEvidence(raw.evidence, {
      operation: raw.operation === "unknown" ? null : raw.operation,
      property_type: raw.property_type,
      location: raw.location,
      surface: raw.surface,
      monthly_rent: monthlyRent,
      sale_price: salePrice,
      transfer_price: transferPrice,
      floor: raw.floor === "unknown" ? null : raw.floor,
      single_floor: raw.single_floor,
      has_basement: raw.has_basement,
      existing_cabins: raw.existing_cabins,
      cabin_capacity: raw.cabin_capacity,
      layout: raw.layout === "unknown" ? null : raw.layout,
      spaces: raw.spaces,
      condition: raw.condition === "unknown" ? null : raw.condition,
      fit_out_estimate: fitOut
    });
    return {
      ...raw,
      id: raw.id || "",
      url_verified: false,
      price: raw.price || monthlyRent || salePrice || transferPrice || 0,
      operation: raw.operation || "unknown",
      monthly_rent: monthlyRent,
      sale_price: salePrice,
      transfer_price: transferPrice,
      existing_cabins: typeof raw.existing_cabins === "number" ? raw.existing_cabins : null,
      cabin_capacity: typeof raw.cabin_capacity === "number" ? raw.cabin_capacity : null,
      layout: raw.layout || "unknown",
      floor: raw.floor || "unknown",
      single_floor: typeof raw.single_floor === "boolean" ? raw.single_floor : null,
      has_basement: typeof raw.has_basement === "boolean" ? raw.has_basement : null,
      spaces: {
        reception_waiting: raw.spaces?.reception_waiting ?? null,
        cabins: raw.spaces?.cabins ?? null,
        staff_area: raw.spaces?.staff_area ?? null,
        laundry_storage: raw.spaces?.laundry_storage ?? null,
        toilets: raw.spaces?.toilets ?? null
      },
      condition: raw.condition || "unknown",
      fit_out_estimate: fitOut,
      initial_investment: {
        confirmedLowerBound: 0,
        estimatedMin: fitOut ? fitOut.min : null,
        estimatedMax: fitOut ? fitOut.max : null,
        complete: false
      },
      evidence,
      unknown_fields: Array.isArray(raw.unknown_fields) ? raw.unknown_fields : [],
      fit_breakdown: [],
      fit_confidence: 0,
      sources: []
    } satisfies Opportunity;
  });
  // Saneo de enlaces + enlace de respaldo:
  //  - url: si es claramente listado/búsqueda/paginación/home, la vaciamos.
  //  - searchUrl: SIEMPRE generamos una búsqueda en el portal (Google
  //    site:dominio "título" zona) para que el usuario pueda llegar a la
  //    ficha aunque no tengamos su URL directa verificada.
  const domainByKey = new Map(portals.map((p) => [p.key.toLowerCase(), p.domain]));
  const domainByLabel = new Map(portals.map((p) => [p.label.toLowerCase(), p.domain]));
  const buildSearchUrl = (o: Opportunity): string => {
    const domain =
      domainByKey.get((o.portal || "").toLowerCase()) ||
      domainByLabel.get((o.portal_label || "").toLowerCase()) ||
      domainByLabel.get((o.portal || "").toLowerCase()) ||
      "";
    const terms = [o.title, o.location].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const q = (domain ? `site:${domain} ` : `${o.portal_label || ""} `) + terms;
    return "https://www.google.com/search?q=" + encodeURIComponent(q.trim());
  };
  const allowedDomains = portals.map((portal) => portal.domain.toLowerCase());
  opps = opps.map((o) => {
    const opportunityDomain =
      domainByKey.get((o.portal || "").toLowerCase()) ||
      domainByLabel.get((o.portal_label || "").toLowerCase());
    return {
      ...o,
      url: cleanOfferUrl(o.url, opportunityDomain ? [opportunityDomain] : allowedDomains),
      url_verified: false,
      searchUrl: buildSearchUrl(o)
    };
  });
  // Verificación HTTP + recogida del texto de las fichas válidas. Las URLs
  // que dan 404 o redirigen a la home se vacían (→ "Buscar en el portal").
  const verified = await verifyAndCollectPages(opps, portals);
  opps = verified.opps;
  // Enriquecimiento: extrae precio/teléfono/superficie reales de las fichas
  // verificadas y recalcula €/m², descuento y rentabilidad.
  opps = await enrichFromPages(workspaceId, opps, verified.pages);
  const candidatesFound = opps.length;
  const matched = matchAndRankOpportunities(opps, params as BusinessPremisesSearch);
  const countedCoverage = coverage.map((item) => ({
    ...item,
    candidates: opps.filter((opportunity) =>
      opportunity.portal.toLowerCase() === item.key.toLowerCase() ||
      opportunity.portal_label.toLowerCase() === item.label.toLowerCase()
    ).length
  }));

  return {
    opportunities: matched.opportunities,
    summary: data.summary ?? "",
    notes: data.notes || undefined,
    searchedPortals: portals.map((p) => ({ key: p.key, label: p.label, bank: p.bank })),
    portalCoverage: countedCoverage,
    stats: {
      candidatesFound,
      duplicatesMerged: matched.duplicatesMerged,
      hardFiltered: matched.hardFiltered,
      returned: matched.opportunities.length
    }
  };
}

export async function searchOpportunities(
  workspaceId: string,
  userId: string | null,
  params: SearchParams
): Promise<SearchResult> {
  const portals = portalsByKeys(params.portals);
  const research = await researchListings(workspaceId, userId, params, portals);
  return analyzeListings(workspaceId, research.research, params, portals, research.coverage);
}
