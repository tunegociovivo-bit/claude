/**
 * «Analizar con IA» de Ajustes → Negocio y voz: lee la web pública del negocio
 * (portada + páginas clave), saca los datos con Claude, busca competidores en
 * Google (si hay Serper) y guarda la ficha del Publicador.
 *
 * Regla de la ficha: «Datos reales del negocio» solo lleva hechos que están en
 * su web o en su ficha de marca; el pipeline de redacción confía en ese campo
 * para no inventar cifras, premios ni testimonios.
 */
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { safeFetch } from "./net";
import { serperSearch } from "./serp";
import { getSeoBlogSettings } from "./settings";
import { asArray, hostOf } from "./util";
import {
  SEO_LANGUAGES,
  competitorCandidates,
  ctaCandidates,
  mapLanguage,
  normalizeDomain,
  parsePage,
  pickPages,
  serperLocale,
  type ParsedPage
} from "./business-site";

const UA = "Mozilla/5.0 (compatible; NVPublicador/1.0; +https://negociovivo.com)";
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const HOME_CHARS = 9000;
const PAGE_CHARS = 5000;
const TOTAL_CHARS = 34000;

export class BusinessSiteError extends Error {}

export function normalizeBusinessUrl(raw: string): string {
  const v = String(raw ?? "").trim();
  if (!v) throw new BusinessSiteError("Escribe la dirección de tu web.");
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withProto);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new Error("bad");
    u.hash = "";
    return u.toString();
  } catch {
    throw new BusinessSiteError("La dirección de la web no es válida.");
  }
}

async function fetchPage(url: string, timeoutMs = 15_000): Promise<ParsedPage | null> {
  const r = await safeFetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(timeoutMs),
    maxBytes: PAGE_MAX_BYTES
  });
  if (!r.ok) return null;
  const type = r.headers.get("content-type") ?? "";
  if (type && !/html/i.test(type)) return null;
  const html = await r.text();
  return parsePage(html, r.url || url);
}

/** Portada + hasta 6 páginas internas, con el texto repetido (menús, pies) quitado. */
export async function crawlBusinessSite(url: string): Promise<{ home: ParsedPage; pages: ParsedPage[] }> {
  let home: ParsedPage | null;
  try {
    home = await fetchPage(url);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    throw new BusinessSiteError(
      /private|no permitida|unsafe/i.test(msg) ? "Esa dirección no está permitida." : `No se pudo leer la web (${msg.slice(0, 120)}).`
    );
  }
  if (!home || home.text.length < 80) throw new BusinessSiteError("La web no devolvió contenido legible. Revisa la dirección.");
  const targets = pickPages(home.links, home.url, 6);
  const settled = await Promise.allSettled(targets.map((t) => fetchPage(t, 12_000)));
  const pages = settled.flatMap((s) => (s.status === "fulfilled" && s.value ? [s.value] : []));
  return { home, pages };
}

function compactText(home: ParsedPage, pages: ParsedPage[]): string {
  const seen = new Set<string>();
  const take = (text: string, max: number) => {
    const kept: string[] = [];
    let len = 0;
    for (const line of text.split("\n")) {
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (len + line.length > max) break;
      kept.push(line);
      len += line.length + 1;
    }
    return kept.join("\n");
  };
  let out = `### Portada: ${home.url}\nTítulo: ${home.title}\nDescripción: ${home.description}\n${take(home.text, HOME_CHARS)}\n`;
  for (const p of pages) {
    if (out.length > TOTAL_CHARS) break;
    const body = take(p.text, Math.min(PAGE_CHARS, TOTAL_CHARS - out.length));
    if (body.length < 40) continue;
    out += `\n### Página: ${p.url}\nTítulo: ${p.title}\n${body}\n`;
  }
  return out;
}

type Analysis = {
  sector: string;
  location: string;
  language: string;
  business_info: string;
  audience: string;
  tone: string;
  cta_text: string;
  cta_url: string;
  brand_voice: string;
  compliance: string;
  forbidden: string;
  competitor_queries: string[];
  brand_color: string;
};

const SCHEMA = {
  type: "object",
  properties: {
    sector: { type: "string" },
    location: { type: "string" },
    language: { type: "string", enum: [...SEO_LANGUAGES] },
    business_info: { type: "string" },
    audience: { type: "string" },
    tone: { type: "string" },
    cta_text: { type: "string" },
    cta_url: { type: "string" },
    brand_voice: { type: "string" },
    compliance: { type: "string" },
    forbidden: { type: "string" },
    competitor_queries: { type: "array", items: { type: "string" } },
    brand_color: { type: "string" }
  },
  required: [
    "sector",
    "location",
    "language",
    "business_info",
    "audience",
    "tone",
    "cta_text",
    "cta_url",
    "brand_voice",
    "compliance",
    "forbidden",
    "competitor_queries",
    "brand_color"
  ]
};

const SYSTEM = `Eres el estratega de contenidos SEO de una agencia de marketing en España. Rellenas la ficha de «Negocio y voz» que usa un redactor IA de artículos de blog para escribir como este negocio.

Trabajas SOLO con el contenido de su web y su ficha de marca que te paso. Reglas de cada campo:
- sector: actividad en 2-6 palabras (p. ej. «Estores, cortinas y toldos a medida»).
- location: ciudad y zona de servicio que la web declara (p. ej. «Málaga y Costa del Sol»). Si la web no lo dice, deja "".
- language: idioma principal de la web.
- business_info: HECHOS VERIFICABLES del negocio, uno por línea empezando por «- »: productos/servicios concretos, marcas o materiales con los que trabajan, cómo trabajan (visita, medición, fabricación, instalación, plazos), zona, años de experiencia, garantías, certificaciones, horario, teléfono, dirección, diferenciales. Copia cifras y datos tal y como aparecen. PROHIBIDO añadir nada que no esté en el texto: ni cifras, ni premios, ni opiniones, ni precios que no aparezcan. Es mejor una lista corta y cierta que una larga inventada. 8-25 líneas.
- audience: 2-4 frases sobre quién compra (perfiles), qué necesita y qué dudas suele tener antes de decidir. Aquí sí puedes deducir a partir de lo que vende.
- tone: una línea, con trato de tú o de usted según use la web (p. ej. «Cercano y experto, tranquilizador. Trato de tú.»).
- cta_text: la llamada a la acción principal de la web (si existe, con sus palabras); si no, una breve y coherente con lo que vende.
- cta_url: elige UNA de las URLs de la lista «Destinos posibles de la llamada a la acción»; si ninguna encaja, la portada.
- brand_voice: cómo habla la marca: rasgos, expresiones propias entre comillas si aparecen en la web, palabras que repite, cómo se dirige al cliente. 3-6 líneas.
- compliance: obligaciones que debe respetar un artículo de este sector en España, en líneas «- » (publicidad, consumidores: precios con IVA y condiciones, no prometer plazos o resultados no garantizados; y las específicas si es un sector regulado: sanidad, estética, alimentación, finanzas, abogados…). 3-7 líneas, prácticas y sin citar artículos de leyes.
- forbidden: palabras o temas a evitar, separados por comas: superlativos no demostrables («el mejor», «el más barato»), nombres de competidores, temas sensibles o ajenos al negocio. Breve.
- competitor_queries: 2-3 búsquedas de Google que haría un cliente para encontrar este tipo de negocio en su zona (para localizar a la competencia).
- brand_color: el color de marca entre los «Colores de la web» (hex #RRGGBB); si ninguno parece de marca, "".

Escribe en español de España salvo los datos copiados literalmente de la web. Sin markdown salvo los guiones de lista.`;

export function buildUser(opts: {
  url: string;
  home: ParsedPage;
  pages: ParsedPage[];
  brand: { name: string; industry: string | null; infoGeneral: string | null; brandBrief: string | null } | null;
}): string {
  const { home, pages, brand } = opts;
  const cta = ctaCandidates([...home.links, ...pages.flatMap((p) => p.links)], home.url);
  const colors = [home.themeColor, ...home.colors].filter(Boolean);
  const jsonLd = [...home.jsonLd, ...pages.flatMap((p) => p.jsonLd)].slice(0, 3);
  return [
    `## Web del negocio: ${opts.url}`,
    `Idioma declarado en el HTML: ${home.lang || "(no indicado)"}`,
    jsonLd.length ? `\n## Datos estructurados de la web (JSON-LD)\n${jsonLd.join("\n")}` : "",
    `\n## Contenido de la web\n${compactText(home, pages)}`,
    `\n## Destinos posibles de la llamada a la acción\n${[home.url, ...cta.map((l) => `${l.url} — ${l.text}`)].map((x) => `- ${x}`).join("\n")}`,
    `\n## Colores de la web\n${colors.length ? [...new Set(colors)].join(", ") : "(ninguno)"}`,
    brand
      ? `\n## Ficha de marca guardada en el CRM (también son datos reales del negocio)\nNombre: ${brand.name}\nSector: ${brand.industry ?? ""}\n${(brand.infoGeneral ?? "").slice(0, 3000)}\n${(brand.brandBrief ?? "").slice(0, 3000)}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

const COMPETITOR_SCHEMA = {
  type: "object",
  properties: { competitors: { type: "array", items: { type: "string" } } },
  required: ["competitors"]
};

/** Busca en Google y deja que la IA quede solo con negocios que compiten de verdad. */
async function findCompetitors(opts: {
  workspaceId: string;
  userId?: string | null;
  url: string;
  language: string;
  sector: string;
  location: string;
  queries: string[];
  apiKey: string | null;
  model: string;
}): Promise<string[] | null> {
  if (!opts.apiKey) return null;
  const { gl, hl } = serperLocale(opts.language);
  const queries = [...new Set([...opts.queries, `${opts.sector} ${opts.location}`].map((q) => q.trim()).filter(Boolean))].slice(0, 4);
  const results = await Promise.all(queries.map((q) => serperSearch(opts.apiKey, q, gl, hl)));
  const organic = results.flatMap((r) => r?.organic ?? []);
  const candidates = competitorCandidates(organic, opts.url, 20);
  if (!candidates.length) return [];
  const res = await completeJson<{ competitors: string[] }>({
    workspaceId: opts.workspaceId,
    userId: opts.userId ?? null,
    feature: "seo_blog_competitors",
    model: opts.model,
    maxTokens: 800,
    schema: COMPETITOR_SCHEMA,
    system:
      "Te paso un negocio y los dominios que salen en Google al buscar lo que vende. Devuelve solo los dominios de empresas que compiten con él por los mismos clientes (venden productos o servicios parecidos en su zona, o online a sus clientes). Excluye directorios, comparadores, medios, blogs, foros, administraciones y marketplaces generalistas. Máximo 10, copiados tal cual de la lista.",
    user: `Negocio: ${opts.sector} — ${opts.location}\nWeb: ${opts.url}\n\nDominios encontrados:\n${candidates
      .map((c) => `- ${c.host} (aparece ${c.hits} veces) · ${c.title} · ${c.snippet}`)
      .join("\n")}`
  });
  const allowed = new Set(candidates.map((c) => c.host));
  return [...new Set(asArray<string>(res?.competitors).map(normalizeDomain).filter((d) => allowed.has(d)))].slice(0, 10);
}

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export type BusinessAnalysisResult = {
  filled: string[];
  pages: string[];
  competitors: { source: "google" | "ficha" | "none"; count: number };
};

/** Analiza la web y guarda los campos de «Negocio y voz» que la IA haya podido rellenar. */
export async function analyzeBusinessAndSave(opts: {
  workspaceId: string;
  siteId: string;
  userId?: string | null;
  url: string;
}): Promise<BusinessAnalysisResult> {
  const site = await prisma.seoBlogSite.findFirst({ where: { id: opts.siteId, workspaceId: opts.workspaceId } });
  if (!site) throw new BusinessSiteError("Web no encontrada.");
  const brand = await prisma.contentBrand.findFirst({
    where: { id: site.clientId, workspaceId: opts.workspaceId, deletedAt: null },
    select: { name: true, industry: true, infoGeneral: true, brandBrief: true, competitors: true }
  });
  const url = normalizeBusinessUrl(opts.url);
  const settings = await getSeoBlogSettings(opts.workspaceId);
  const { home, pages } = await crawlBusinessSite(url);

  const a = await completeJson<Analysis>({
    workspaceId: opts.workspaceId,
    userId: opts.userId ?? null,
    feature: "seo_blog_analyze_business",
    model: settings.modelFast,
    maxTokens: 5000,
    schema: SCHEMA,
    system: SYSTEM,
    user: buildUser({ url: home.url, home, pages, brand })
  });

  const language = SEO_LANGUAGES.includes(a.language as any) ? a.language : mapLanguage(home.lang) ?? site.language;
  const ownHost = hostOf(home.url);
  let ctaUrl = clip(a.cta_url, 500);
  if (!/^https?:\/\//i.test(ctaUrl) || hostOf(ctaUrl) !== ownHost) ctaUrl = home.url;

  let competitors: string[] | null = null;
  let source: BusinessAnalysisResult["competitors"]["source"] = "none";
  try {
    competitors = await findCompetitors({
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      url: home.url,
      language,
      sector: clip(a.sector, 200),
      location: clip(a.location, 200),
      queries: asArray<string>(a.competitor_queries).map((q) => clip(q, 120)),
      apiKey: settings.serperApiKey,
      model: settings.modelFast
    });
    if (competitors) source = "google";
  } catch (e) {
    console.warn("[seo-blog] competidores:", e);
  }
  if (!competitors?.length) {
    const fromBrand = String(brand?.competitors ?? "")
      .split(/[\n,;]+/)
      .map(normalizeDomain)
      .filter(Boolean);
    if (fromBrand.length) {
      competitors = [...new Set(fromBrand)].slice(0, 15);
      source = "ficha";
    }
  }

  const candidate: Record<string, string> = {
    sector: clip(a.sector, 500),
    location: clip(a.location, 500),
    language,
    businessInfo: clip(a.business_info, 20000),
    audience: clip(a.audience, 20000),
    tone: clip(a.tone, 500),
    ctaText: clip(a.cta_text, 500),
    ctaUrl,
    brandVoice: clip(a.brand_voice, 20000),
    compliance: clip(a.compliance, 20000),
    forbidden: clip(a.forbidden, 20000),
    competitors: competitors?.length ? competitors.join("\n") : "",
    color: /^#[0-9a-f]{6}$/i.test(String(a.brand_color ?? "").trim()) ? String(a.brand_color).trim().toUpperCase() : ""
  };
  // Solo se sobrescribe lo que la IA ha podido rellenar: un campo vacío conserva lo que hubiera.
  const data = Object.fromEntries(Object.entries(candidate).filter(([, v]) => v));
  if (Object.keys(data).length) {
    await prisma.seoBlogSite.updateMany({ where: { id: site.id, workspaceId: opts.workspaceId }, data });
  }
  return {
    filled: Object.keys(data),
    pages: [home.url, ...pages.map((p) => p.url)],
    competitors: { source, count: competitors?.length ?? 0 }
  };
}
