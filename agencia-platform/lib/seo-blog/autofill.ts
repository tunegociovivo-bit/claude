/**
 * Análisis de la web del cliente: rastrea las páginas clave (inicio, sobre nosotros, servicios, contacto, legal)
 * y pide a la IA que rellene la ficha «Negocio y voz» solo con datos que aparezcan en la web.
 */
import { completeJson } from "@/lib/ai/anthropic";
import { hostOf, plainText } from "./util";
import { normalizeSiteUrl } from "./wp";
import { serperSearch } from "./serp";
import type { SeoBlogSettings } from "./settings";

const UA = "Mozilla/5.0 (compatible; NVPublicador/1.0; +https://negociovivo.com)";
/** Prioridad de páginas: primero quiénes somos y contacto, luego servicios, legal y el resto. */
function pathScore(pathname: string): number {
  const p = pathname.toLowerCase();
  const depth = p.split("/").filter(Boolean).length;
  if (/(sobre|nosotros|about|quienes|quiénes|equipo|team|historia|clinica|clínica|empresa|doctor|dr-)/.test(p)) return 40;
  if (/(contact|contacto|cita|reserva|presupuesto)/.test(p)) return 35;
  if (/(servicio|service|tratamiento|especialidad|producto|catalogo|catálogo)/.test(p)) return depth <= 1 ? 30 : 12;
  if (/(legal|aviso|privacidad|privacy|condiciones)/.test(p)) return 20;
  if (/(faq|preguntas|precio|tarifa|opinion|reseña|clientes|casos|porque|por-que|garantia)/.test(p)) return 15;
  return depth <= 1 ? 5 : 1;
}

type Page = { url: string; title: string; description: string; headings: string[]; text: string; jsonld: string[] };

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (ct && !/html|xml/i.test(ct)) return null;
    return { html: (await r.text()).slice(0, 2_000_000), finalUrl: r.url || url };
  } catch {
    return null;
  }
}

function parsePage(url: string, html: string): Page {
  const title = plainText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").slice(0, 200);
  const description = (/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1] ?? "").slice(0, 300);
  const jsonld: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const t = m[1].trim();
    if (t && /Organization|LocalBusiness|MedicalBusiness|Dentist|Physician|Store|Restaurant|Hotel|Service|Person/i.test(t)) jsonld.push(t.slice(0, 3000));
  }
  let body = html.replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, "");
  const headings: string[] = [];
  for (const m of body.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const t = plainText(m[2]);
    if (t && t.length < 160) headings.push(`H${m[1]}: ${t}`);
  }
  const stripped = body.replace(/<(nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, "");
  const mainHtml = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(body)?.[1] ?? /<article[^>]*>([\s\S]*?)<\/article>/i.exec(body)?.[1] ?? "";
  let text = plainText(mainHtml).replace(/\s+/g, " ").trim();
  if (text.length < 500) text = plainText(stripped).replace(/\s+/g, " ").trim(); // Elementor y similares no usan <main>
  text = text.slice(0, 7000);
  return { url, title, description, headings: headings.slice(0, 40), text, jsonld: jsonld.slice(0, 3) };
}

export async function crawlSite(inputUrl: string, maxPages = 7): Promise<{ base: string; pages: Page[]; footer: string }> {
  const base = normalizeSiteUrl(inputUrl);
  const host = hostOf(base);
  const home = await fetchPage(base + "/");
  if (!home) throw new Error(`No se pudo leer la web (${base}). Comprueba la URL o si la web bloquea robots.`);
  const pages: Page[] = [parsePage(home.finalUrl, home.html)];
  const footer = plainText(/<footer[^>]*>([\s\S]*?)<\/footer>/i.exec(home.html)?.[1] ?? "").replace(/\s+/g, " ").slice(0, 1500);
  // Enlaces internos candidatos, priorizando páginas "clave"
  const links = new Map<string, number>();
  for (const m of home.html.matchAll(/<a[^>]+href=["']([^"'#?]+)[^"']*["']/gi)) {
    let href = m[1].trim();
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const u = new URL(href, base + "/");
      if (u.host.replace(/^www\./, "") !== host.replace(/^www\./, "")) continue;
      if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|css|js)$/i.test(u.pathname)) continue;
      if (/\/(wp-admin|wp-login|wp-json|feed|tag|category|author|page\/\d+)/i.test(u.pathname)) continue;
      const clean = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
      if (clean === base || clean === base + "/") continue;
      const score = pathScore(u.pathname);
      links.set(clean, Math.max(links.get(clean) ?? 0, score));
    } catch {}
  }
  const ordered = [...links.entries()].sort((a, b) => b[1] - a[1]);
  let lowUsed = 0;
  for (const [u, score] of ordered) {
    if (pages.length >= maxPages) break;
    if (score <= 12 && lowUsed >= 3) continue;
    if (score <= 12) lowUsed++;
    const p = await fetchPage(u);
    if (!p) continue;
    const parsed = parsePage(p.finalUrl, p.html);
    if (parsed.text.length > 200) pages.push(parsed);
  }
  return { base, pages, footer };
}

export const AUTOFILL_SCHEMA = {
  type: "object",
  properties: {
    sector: { type: "string" },
    location: { type: "string" },
    language: { type: "string", enum: ["es-ES", "es-MX", "en-GB", "en-US", "de-DE", "fr-FR", "it-IT", "pt-PT", "ca-ES"] },
    businessInfo: { type: "string" },
    audience: { type: "string" },
    tone: { type: "string" },
    brandVoice: { type: "string" },
    ctaText: { type: "string" },
    ctaUrl: { type: "string" },
    compliance: { type: "string" },
    forbidden: { type: "string" },
    competitors: { type: "array", items: { type: "string" } },
    summary: { type: "string" }
  },
  required: ["sector", "location", "language", "businessInfo", "audience", "tone", "brandVoice", "ctaText", "ctaUrl", "compliance", "forbidden", "competitors", "summary"]
};

export async function autofillFromSite(
  workspaceId: string,
  userId: string | null | undefined,
  settings: SeoBlogSettings,
  url: string,
  clientName: string,
  brandBrief?: string | null
) {
  const { base, pages, footer } = await crawlSite(url);
  const host = hostOf(base);
  const dump = pages
    .map((p, i) => `=== PÁGINA ${i + 1}: ${p.url}\nTítulo: ${p.title}\nMeta: ${p.description}\n${p.headings.join("\n")}\n${p.jsonld.length ? "JSON-LD: " + p.jsonld.join("\n") + "\n" : ""}TEXTO: ${p.text}`)
    .join("\n\n")
    .slice(0, 60_000);
  // Competidores: top orgánico de Google para «sector + localidad» (si hay Serper), excluyendo la propia web
  let serpHint = "";
  const system =
    "Eres un estratega de contenidos de la agencia Negocio Vivo. A partir del contenido REAL de la web de un cliente rellenas su ficha de marca para redactar su blog SEO. " +
    "Regla de oro: solo afirmas lo que aparece en la web (o en el brief del CRM). Si un dato no aparece, lo dejas fuera; nunca inventas años, cifras, premios, certificaciones ni testimonios. " +
    "Escribe en el idioma de la web. Sé concreto y útil para un redactor.";
  const user =
    `CLIENTE (CRM): ${clientName}\nWEB: ${base}\n${brandBrief ? `BRIEF DEL CRM:\n${brandBrief.slice(0, 4000)}\n` : ""}\nPIE DE PÁGINA: ${footer}\n\nCONTENIDO DE LA WEB:\n${dump}\n\n` +
    "Rellena la ficha. Campos:\n" +
    "- sector: actividad principal en 3–8 palabras (p. ej. «Clínica de cirugía y medicina estética»).\n" +
    "- location: ciudad/zona de servicio tal y como aparece en la web (dirección, localidades citadas). Vacío si no consta.\n" +
    "- language: código del idioma principal de la web.\n" +
    "- businessInfo: 8–15 líneas con datos verificables: servicios/tratamientos (lista), equipo y titulaciones citadas, años/experiencia si constan, certificaciones, instalaciones, horarios, zonas, diferenciales, garantías, proceso de trabajo. Formato: viñetas con «- ».\n" +
    "- audience: a quién se dirige (perfil, necesidad, situación), deducido del contenido.\n" +
    "- tone: 1 línea (p. ej. «Cercano y experto, trato de tú, sin tecnicismos innecesarios»). Indica si la web tutea o trata de usted.\n" +
    "- brandVoice: expresiones, lemas, claims y formas de hablar propias que aparecen en la web (entre comillas), y qué evita.\n" +
    "- ctaText: la llamada a la acción principal que usa la web (botón o frase).\n" +
    "- ctaUrl: la URL de contacto/reserva/presupuesto de esta web (debe ser de " + host + ").\n" +
    "- compliance: obligaciones legales del sector que afecten a la redacción (sanitario: Ley 34/1988 y RD 1907/1996, sin promesas de resultados ni antes/después; alimentación: reglamento de declaraciones; finanzas/seguros: advertencias; abogacía: deontología; etc.). Si el sector no tiene restricciones especiales, indica «Sin restricciones sectoriales específicas; cumplir LSSI/RGPD en formularios».\n" +
    "- forbidden: temas o palabras a evitar según lo que se deduce (p. ej. marcas de terceros, precios no publicados, promesas absolutas). Vacío si nada.\n" +
    "- competitors: dominios de competidores SOLO si aparecen citados en la web; si no, lista vacía.\n" +
    "- summary: 2 frases en español resumiendo el negocio para el equipo.";
  const res = await completeJson<any>({
    workspaceId,
    userId: userId ?? null,
    feature: "seo_blog_autofill",
    model: settings.modelFast,
    maxTokens: 6000,
    schema: AUTOFILL_SCHEMA,
    system,
    user
  });
  // Competidores desde Google (si hay Serper) cuando la web no cita ninguno
  let competitors: string[] = Array.isArray(res.competitors) ? res.competitors.map((c: string) => hostOf(c.startsWith("http") ? c : "https://" + c)).filter(Boolean) : [];
  if (!competitors.length && settings.serperApiKey && res.sector) {
    const s = await serperSearch(settings.serperApiKey, `${res.sector} ${res.location || ""}`.trim(), settings.serperGl, settings.serperHl).catch(() => null);
    if (s) {
      const bad = /(google|wikipedia|facebook|instagram|youtube|linkedin|tripadvisor|yelp|paginasamarillas|infobel|cylex|doctoralia|idealista|milanuncios|amazon)\./i;
      competitors = [...new Set((s.organic ?? []).map((o: any) => hostOf(o.link)).filter((h: string) => h && h.replace(/^www\./, "") !== host.replace(/^www\./, "") && !bad.test(h)))].slice(0, 5);
      serpHint = "competidores sugeridos desde Google";
    }
  }
  const out = {
    sector: String(res.sector ?? "").slice(0, 200),
    location: String(res.location ?? "").slice(0, 200),
    language: String(res.language ?? "es-ES"),
    businessInfo: String(res.businessInfo ?? "").slice(0, 8000),
    audience: String(res.audience ?? "").slice(0, 2000),
    tone: String(res.tone ?? "").slice(0, 300),
    brandVoice: String(res.brandVoice ?? "").slice(0, 3000),
    ctaText: String(res.ctaText ?? "").slice(0, 200),
    ctaUrl: String(res.ctaUrl ?? "").slice(0, 500),
    compliance: String(res.compliance ?? "").slice(0, 3000),
    forbidden: String(res.forbidden ?? "").slice(0, 2000),
    competitors: competitors.join("\n"),
    summary: String(res.summary ?? ""),
    pagesRead: pages.map((p) => p.url),
    siteUrl: base,
    note: serpHint
  };
  if (out.ctaUrl && hostOf(out.ctaUrl).replace(/^www\./, "") !== host.replace(/^www\./, "")) out.ctaUrl = "";
  return out;
}
