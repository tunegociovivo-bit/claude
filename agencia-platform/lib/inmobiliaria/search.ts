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
import { portalsByKeys, type Portal } from "./portals";

// Modelo para la fase de investigación con búsqueda web. Usamos el modelo
// estándar del workspace para mantener consistencia con el resto de la app.
const RESEARCH_MODEL = DEFAULT_MODEL;

export type OccupancyFilter = "any" | "occupied" | "free";

export type SearchParams = {
  location: string;
  propertyType?: string;
  objective?: string; // alquiler | reventa | vivienda
  /** Estado de ocupación buscado: indiferente, con okupas dentro, o libre/desocupada */
  occupancy?: OccupancyFilter;
  minPrice?: number;
  maxPrice?: number;
  minSurface?: number;
  portals: string[];
  maxResults?: number;
  onlyOpportunities?: boolean;
};

export type Opportunity = {
  portal: string;
  portal_label: string;
  bank: string;
  title: string;
  property_type: string;
  location: string;
  url: string;
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
};

export type SearchResult = {
  opportunities: Opportunity[];
  summary: string;
  searchedPortals: { key: string; label: string; bank: string }[];
  notes?: string;
};

function buildResearchPrompt(params: SearchParams, portals: Portal[]): string {
  const lines: string[] = [];
  lines.push(
    "Eres un analista experto en inversión inmobiliaria especializado en activos de banca (pisos, casas y locales adjudicados o en venta por entidades bancarias)."
  );
  lines.push(
    "Tu tarea: buscar en la web propiedades reales EN VENTA que encajen con los criterios indicados, EXCLUSIVAMENTE en estos portales:"
  );
  portals.forEach((p) => {
    lines.push(
      `- ${p.label} (${p.bank}) → ${p.url}${p.note ? ` — ${p.note}` : ""}`
    );
  });
  lines.push("");
  lines.push("CRITERIOS DE BÚSQUEDA:");
  lines.push(`- Ubicación / zona: ${params.location}`);
  if (params.propertyType) lines.push(`- Tipo de inmueble: ${params.propertyType}`);
  if (params.objective) lines.push(`- Objetivo de la inversión: ${params.objective}`);
  if (params.occupancy === "occupied") {
    lines.push(
      "- Estado de ocupación: BUSCA SOLO viviendas OCUPADAS (con okupas/inquilinos dentro). Son habituales en Trial3 y otros portales: suelen tener gran descuento pero mayor riesgo (desahucio, posesión no garantizada). Descarta las que estén libres."
    );
  } else if (params.occupancy === "free") {
    lines.push(
      "- Estado de ocupación: BUSCA SOLO viviendas LIBRES / desocupadas (posesión inmediata, sin okupas ni inquilinos). Descarta las que estén ocupadas."
    );
  } else {
    lines.push(
      "- Estado de ocupación: indiferente. Incluye tanto viviendas libres como ocupadas, indicando claramente en cada una si está ocupada o no."
    );
  }
  if (params.minPrice) lines.push(`- Precio mínimo: ${params.minPrice} €`);
  if (params.maxPrice) lines.push(`- Precio máximo: ${params.maxPrice} €`);
  if (params.minSurface) lines.push(`- Superficie mínima: ${params.minSurface} m²`);
  lines.push("");
  lines.push("INSTRUCCIONES:");
  lines.push(
    "1. Haz TODAS las búsquedas web que necesites, acotadas a los portales anteriores (usa site: con sus dominios: " +
      portals.map((p) => p.domain).join(", ") +
      "), paginando y probando varios términos (calle, barrio, distrito, tipo) para encontrar el MÁXIMO número de propiedades que cumplan los criterios."
  );
  lines.push(
    "2. Para CADA propiedad encontrada recopila: portal de origen, título/referencia, tipo, ubicación exacta, precio de venta, superficie (m²), enlace directo a la ficha, y si la vivienda está OCUPADA (frecuente en Trial3)."
  );
  lines.push(
    "2b. ENLACE: el enlace de cada propiedad debe ser la URL EXACTA de su ficha individual (la página de ESA vivienda concreta, que normalmente lleva su referencia o ID en la URL). NO valen: la home del portal, una página de resultados/listado, una búsqueda, ni una URL de paginación. Usa la URL concreta de la ficha que aparezca en los resultados de búsqueda. Si para alguna propiedad no dispones del enlace directo a su ficha, deja su enlace VACÍO (no pongas uno genérico)."
  );
  lines.push(
    "3. Busca también el precio medio de mercado por m² de la zona (idealista/fotocasa/INE) y un alquiler mensual de referencia, para poder estimar descuento sobre mercado y rentabilidad."
  );
  lines.push(
    "4. Reúne TODAS las propiedades que encuentres que cumplan los criterios; NO te limites a un número fijo: intenta llegar a 30-50 o más si existen. Incluye también opciones dudosas; en la siguiente fase se filtrarán."
  );
  lines.push(
    "5. Devuelve un informe detallado en texto con TODAS las propiedades encontradas (una por una, sin omitir ninguna) y sus datos, además del contexto de precios de la zona. Incluye SIEMPRE el enlace real de cada ficha. No inventes propiedades ni enlaces: si no encuentras datos suficientes de alguna, indícalo igualmente."
  );
  return lines.join("\n");
}

/** Fase 1: investigación con búsqueda web nativa de Anthropic. */
async function researchListings(
  workspaceId: string,
  userId: string | null,
  params: SearchParams,
  portals: Portal[]
): Promise<string> {
  const client = await getAnthropicForWorkspace(workspaceId);
  const allowedDomains = portals.map((p) => p.domain).concat(["idealista.com", "fotocasa.es", "ine.es"]);

  // Solo búsqueda web (generación probada). No usamos web_fetch: abrir las
  // páginas completas es lento y hacía que la petición superara el tiempo
  // límite del servidor (timeout → "Error en la búsqueda"). Para acotar el
  // enlace a la ficha nos apoyamos en el prompt + saneo de URLs.
  const WEB_SEARCH_TOOL: any = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 12,
    allowed_domains: allowedDomains
  };

  const messages: any[] = [
    { role: "user", content: buildResearchPrompt(params, portals) }
  ];

  let webSearchEnabled = true;
  let totalIn = 0;
  let totalOut = 0;

  async function create(): Promise<any> {
    const tools = webSearchEnabled ? [WEB_SEARCH_TOOL] : [];
    try {
      return await client.messages.create({
        model: RESEARCH_MODEL,
        max_tokens: 12000,
        tools: tools as any,
        messages
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (webSearchEnabled && /web.?search|web_search_20|allowed_domains|tool/i.test(msg)) {
        webSearchEnabled = false;
        return await client.messages.create({
          model: RESEARCH_MODEL,
          max_tokens: 12000,
          messages
        });
      }
      throw e;
    }
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
function cleanOfferUrl(raw: string | null | undefined): string {
  const s = (raw || "").trim();
  if (!s) return "";
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return "";
  }
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
async function fetchOfferPage(u: string): Promise<{ ok: boolean; text: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(u, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html"
      }
    });
    if (!res.ok) {
      clearTimeout(timer);
      try { await res.body?.cancel(); } catch {}
      return { ok: false, text: "" };
    }
    const orig = new URL(u);
    const final = new URL(res.url || u);
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
  opps: Opportunity[]
): Promise<{ opps: Opportunity[]; pages: Map<number, string> }> {
  const idxs = opps.map((o, i) => (o.url ? i : -1)).filter((i) => i >= 0);
  const pages = new Map<number, string>();
  const CONCURRENCY = 6;
  for (let i = 0; i < idxs.length; i += CONCURRENCY) {
    const batch = idxs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((idx) => fetchOfferPage(opps[idx].url)));
    batch.forEach((idx, k) => {
      if (!results[k].ok) opps[idx] = { ...opps[idx], url: "" };
      else if (results[k].text) pages.set(idx, results[k].text);
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
          phone: { anyOf: [{ type: "string" }, { type: "null" }] },
          surface: { anyOf: [{ type: "number" }, { type: "null" }] },
          address: { anyOf: [{ type: "string" }, { type: "null" }] }
        },
        required: ["index", "price", "phone", "surface", "address"]
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
  let extracted: { items: Array<{ index: number; price: number | null; phone: string | null; surface: number | null; address: string | null }> };
  try {
    extracted = await completeJson({
      workspaceId,
      system:
        "Extraes datos de fichas inmobiliarias a partir del texto real de su página web. Para cada ficha devuelve el PRECIO de venta actual en euros (el precio de venta del inmueble; si hay precio rebajado/actual y otro tachado, usa el ACTUAL), el TELÉFONO de contacto, la SUPERFICIE en m² y la DIRECCIÓN/ubicación. Usa null si un dato no aparece. No inventes nada. Responde solo con el JSON del schema.",
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
    if (it.phone && it.phone.trim()) next.phone = it.phone.trim();
    if (typeof it.surface === "number" && it.surface > 0 && !next.surface) next.surface = it.surface;
    if (it.address && it.address.trim() && (!next.location || next.location.length < 4))
      next.location = it.address.trim();
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
  portals: Portal[]
): Promise<SearchResult> {
  const system = [
    "Eres un analista senior de inversión inmobiliaria. Recibes una investigación de propiedades de portales de banca y debes evaluar cada una como oportunidad de inversión.",
    "Criterios de puntuación (score 0-100): descuento real sobre el precio de mercado de la zona, rentabilidad bruta por alquiler, liquidez/demanda de la zona, estado y riesgos (vivienda ocupada, cargas, reforma), y potencial de revalorización.",
    "Veredicto: 'OPORTUNIDAD' (score ≥ 70, inversión muy atractiva), 'INTERESANTE' (score 50-69), 'DESCARTAR' (score < 50).",
    "Penaliza con fuerza las viviendas ocupadas salvo que el descuento lo compense claramente. Sé riguroso y realista: no infles los scores.",
    "No inventes propiedades: usa SOLO las que aparecen en la investigación, con sus enlaces reales. Calcula price_m2, discount_pct (% bajo mercado) y gross_yield (rentabilidad bruta anual = alquiler_anual / precio * 100) cuando haya datos; si no, deja null.",
    "IMPORTANTE: evalúa y devuelve TODAS las propiedades que aparezcan en la investigación, sin omitir ni recortar ninguna (pueden ser 30, 40 o más). Para que quepan todas, sé CONCISO: máximo 3 pros y 3 cons (frases muy breves) y un 'reasoning' de 1-2 frases por propiedad.",
    "URL: el campo url SOLO debe contener el enlace DIRECTO a la ficha individual de esa propiedad concreta (con su ID/referencia). Si en la investigación solo hay para esa propiedad un enlace de listado, búsqueda, paginación o la home del portal, deja url como cadena vacía (\"\"). Nunca uses una URL genérica o de resultados.",
    "Responde SIEMPRE en español."
  ].join("\n");

  const objective = params.objective ? `Objetivo del inversor: ${params.objective}.` : "";
  let occupancyLine = "";
  if (params.occupancy === "occupied") {
    occupancyLine =
      "El inversor BUSCA EXPRESAMENTE viviendas OCUPADAS (con okupas/inquilinos dentro) como estrategia de gran descuento. Devuelve ÚNICAMENTE propiedades ocupadas (occupied=true). NO penalices el score solo por estar ocupada: valora el descuento frente al riesgo real (coste y plazo de desalojo, posesión no garantizada, cargas) y refléjalo en pros/cons.";
  } else if (params.occupancy === "free") {
    occupancyLine =
      "El inversor SOLO quiere viviendas LIBRES / desocupadas (posesión inmediata). Devuelve ÚNICAMENTE propiedades libres (occupied=false) y descarta las ocupadas.";
  } else {
    occupancyLine =
      "Estado de ocupación indiferente: incluye libres y ocupadas. Penaliza el score de las ocupadas salvo que el descuento lo compense claramente, e indica el estado en occupied.";
  }
  const user = [
    `Criterios del inversor — Zona: ${params.location}. ${params.propertyType ? `Tipo: ${params.propertyType}. ` : ""}${objective}`,
    occupancyLine,
    params.onlyOpportunities
      ? "Evalúa TODAS las propiedades de la investigación y devuelve TODAS las que tengan veredicto OPORTUNIDAD o INTERESANTE (no recortes la lista), ordenadas de más a menos interesante (mayor a menor score)."
      : "Evalúa y devuelve TODAS las propiedades de la investigación, sin omitir ninguna, ordenadas de más a menos interesante (mayor a menor score).",
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
      schema: OPPORTUNITY_SCHEMA,
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
        schema: OPPORTUNITY_SCHEMA,
        maxTokens: 12000
      });
    } else {
      throw e;
    }
  }

  let opps = Array.isArray(data.opportunities) ? data.opportunities : [];
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
  opps = opps.map((o) => ({ ...o, url: cleanOfferUrl(o.url), searchUrl: buildSearchUrl(o) }));
  // Verificación HTTP + recogida del texto de las fichas válidas. Las URLs
  // que dan 404 o redirigen a la home se vacían (→ "Buscar en el portal").
  const verified = await verifyAndCollectPages(opps);
  opps = verified.opps;
  // Enriquecimiento: extrae precio/teléfono/superficie reales de las fichas
  // verificadas y recalcula €/m², descuento y rentabilidad.
  opps = await enrichFromPages(workspaceId, opps, verified.pages);
  // Filtro duro por estado de ocupación (red de seguridad sobre el prompt).
  if (params.occupancy === "occupied") {
    opps = opps.filter((o) => o.occupied === true);
  } else if (params.occupancy === "free") {
    opps = opps.filter((o) => o.occupied === false);
  }
  if (params.onlyOpportunities) {
    opps = opps.filter((o) => o.verdict !== "DESCARTAR");
  }
  opps.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (params.maxResults && opps.length > params.maxResults) {
    opps = opps.slice(0, params.maxResults);
  }

  return {
    opportunities: opps,
    summary: data.summary ?? "",
    notes: data.notes || undefined,
    searchedPortals: portals.map((p) => ({ key: p.key, label: p.label, bank: p.bank }))
  };
}

export async function searchOpportunities(
  workspaceId: string,
  userId: string | null,
  params: SearchParams
): Promise<SearchResult> {
  const portals = portalsByKeys(params.portals);
  const research = await researchListings(workspaceId, userId, params, portals);
  return analyzeListings(workspaceId, research, params, portals);
}
