/**
 * Lectura de la web pública de un negocio para rellenar «Negocio y voz» del
 * Publicador SEO. Funciones puras (sin red ni base de datos) para poder
 * probarlas: extracción de texto, enlaces, idioma, colores y selección de las
 * páginas que mejor describen el negocio.
 *
 * Todas las búsquedas son lineales (indexOf / regex sin retroceso anidado):
 * el HTML viene de una URL que escribe el usuario.
 */
import { decodeEntities, hostOf } from "./util";

export const SEO_LANGUAGES = ["es-ES", "es-MX", "en-GB", "en-US", "de-DE", "fr-FR", "it-IT", "pt-PT", "ca-ES"] as const;
export type SeoLanguage = (typeof SEO_LANGUAGES)[number];

export type PageLink = { url: string; text: string; count: number };
export type ParsedPage = {
  url: string;
  title: string;
  description: string;
  lang: string;
  themeColor: string;
  jsonLd: string[];
  text: string;
  links: PageLink[];
  colors: string[];
};

const DROP = ["script", "style", "noscript", "svg", "template", "iframe", "canvas", "object"];

/** Quita etiquetas con su contenido sin regex con retroceso (como el saneador de la vista previa). */
export function dropBlocks(html: string, names: string[] = DROP): string {
  const lower = html.toLowerCase();
  const open = new RegExp(`<(${names.join("|")})\\b`, "gi");
  const noCloseAfter = new Map<string, number>();
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    const name = m[1].toLowerCase();
    const from = m.index;
    if ((noCloseAfter.get(name) ?? Infinity) <= from) continue;
    const close = lower.indexOf(`</${name}`, from + 1);
    const end = close < 0 ? -1 : lower.indexOf(">", close);
    if (end < 0) {
      noCloseAfter.set(name, from);
      continue;
    }
    out += html.slice(last, from) + " ";
    last = end + 1;
    open.lastIndex = last;
  }
  return out + html.slice(last);
}

/** Atributos de una etiqueta con un escáner lineal (sin regex que pueda retroceder). */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const n = Math.min(tag.length, 20_000);
  const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";
  let i = 1;
  while (i < n && !isSpace(tag[i]) && tag[i] !== ">" && tag[i] !== "/") i++; // nombre de la etiqueta
  while (i < n) {
    while (i < n && (isSpace(tag[i]) || tag[i] === "/")) i++;
    if (i >= n || tag[i] === ">") break;
    const start = i;
    while (i < n && !isSpace(tag[i]) && tag[i] !== "=" && tag[i] !== ">" && tag[i] !== "/") i++;
    const name = tag.slice(start, i).toLowerCase();
    if (i === start) {
      i++;
      continue;
    }
    while (i < n && isSpace(tag[i])) i++;
    if (tag[i] !== "=") {
      if (name && !(name in out)) out[name] = "";
      continue;
    }
    i++;
    while (i < n && isSpace(tag[i])) i++;
    let value = "";
    const q = tag[i];
    if (q === '"' || q === "'") {
      const end = tag.indexOf(q, i + 1);
      const stop = end < 0 || end > n ? n : end;
      value = tag.slice(i + 1, stop);
      i = stop + 1;
    } else {
      const v0 = i;
      while (i < n && !isSpace(tag[i]) && tag[i] !== ">") i++;
      value = tag.slice(v0, i);
    }
    if (name && !(name in out)) out[name] = decodeEntities(value);
  }
  return out;
}

const BLOCK_TAG = /<\/?(?:p|div|section|article|header|footer|nav|main|aside|li|ul|ol|br|hr|tr|td|th|table|address|blockquote|figcaption|dd|dt|dl|form|label|button|option)\b[^<>]*>/gi;

/** Quita los comentarios HTML en una sola pasada. */
function stripComments(html: string): string {
  let out = "";
  let last = 0;
  for (;;) {
    const from = html.indexOf("<!--", last);
    if (from < 0) break;
    const end = html.indexOf("-->", from + 4);
    out += html.slice(last, from) + " ";
    if (end < 0) return out;
    last = end + 3;
  }
  return out + html.slice(last);
}

const CONSENT_ATTR = /(cookie|cmplz|consent|gdpr|cky-|cookielawinfo|moove|borlabs|iubenda|onetrust|didomi|cookiebot)/i;

/**
 * Quita los avisos de cookies (Complianz, CookieYes, OneTrust…): bloques cuyo id o
 * class los delata, con todo su contenido anidado. Si un bloque no cierra, para.
 */
export function dropConsentBlocks(html: string): string {
  const open = /<(div|section|aside|dialog)\b[^<>]*>/gi;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    const a = attrs(m[0]);
    if (!CONSENT_ATTR.test(`${a.id ?? ""} ${a.class ?? ""}`)) continue;
    const tag = new RegExp(`<(/?)${m[1]}\\b[^<>]*>`, "gi");
    tag.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = -1;
    let t: RegExpExecArray | null;
    while ((t = tag.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    if (end < 0) break;
    out += html.slice(last, m.index) + " ";
    last = end;
    open.lastIndex = end;
  }
  return out + html.slice(last);
}

/** Texto visible por líneas; los encabezados llevan «#» delante para conservar la estructura. */
export function pageText(html: string): string {
  const lower = html.toLowerCase();
  const bodyAt = lower.indexOf("<body");
  let s = bodyAt >= 0 ? html.slice(bodyAt) : html;
  s = dropBlocks(dropConsentBlocks(stripComments(s)));
  s = s.replace(/<h([1-6])\b[^<>]*>/gi, (_m, n) => `\n${"#".repeat(Number(n))} `);
  s = s.replace(/<\/h[1-6]>/gi, "\n");
  s = s.replace(BLOCK_TAG, "\n").replace(/<[^<>]*>/g, " ");
  s = decodeEntities(s);
  const lines: string[] = [];
  for (const raw of s.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 2 || /^#+$/.test(line) || /\{[a-z_]+\}/i.test(line)) continue;
    if (lines[lines.length - 1] === line) continue;
    lines.push(line);
  }
  return lines.join("\n");
}

function isGray(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 28 || max < 35 || min > 235;
}

/** Colores con tono (sin grises, blancos ni negros), del más al menos usado. */
export function brandColorCandidates(html: string, max = 10): string[] {
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const hex = `#${m[1].toUpperCase()}`;
    if (isGray(hex)) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([h]) => h);
}

function collectLinks(html: string, baseUrl: string): PageLink[] {
  const lower = html.toLowerCase();
  const byUrl = new Map<string, PageLink>();
  const re = /<a\b[^<>]*>/gi;
  let m: RegExpExecArray | null;
  // Posición del siguiente «</a»: se reutiliza mientras siga por delante (lineal aunque falten cierres).
  let nextClose = -2;
  while ((m = re.exec(html))) {
    const href = attrs(m[0]).href;
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href.trim())) continue;
    let url: URL;
    try {
      url = new URL(href.trim(), baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    url.hash = "";
    const start = m.index + m[0].length;
    if (nextClose !== -1 && nextClose < start) nextClose = lower.indexOf("</a", start);
    const close = nextClose;
    const inner = close >= 0 && close - start < 3000 ? html.slice(start, close) : "";
    const text = decodeEntities(inner.replace(/<[^<>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 120);
    const key = url.toString();
    const prev = byUrl.get(key);
    if (prev) {
      prev.count++;
      if (!prev.text && text) prev.text = text;
    } else byUrl.set(key, { url: key, text, count: 1 });
  }
  return [...byUrl.values()];
}

function jsonLdBlocks(html: string): string[] {
  const lower = html.toLowerCase();
  const out: string[] = [];
  const re = /<script\b[^<>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 4) {
    if (!/application\/ld\+json/i.test(m[0])) continue;
    const start = m.index + m[0].length;
    const close = lower.indexOf("</script", start);
    if (close < 0) break;
    const raw = html.slice(start, close).trim();
    // Solo lo que describe al negocio (dirección, horario, zona…), no el grafo genérico de Yoast.
    const compact = raw.replace(/\s+/g, " ").slice(0, 3500);
    if (/Business|Store|PostalAddress|openingHours|areaServed|telephone|"@type":\s*"(Service|Product)"/i.test(raw) && !out.includes(compact)) {
      out.push(compact);
    }
    re.lastIndex = close;
  }
  return out;
}

export function parsePage(html: string, url: string): ParsedPage {
  const head = html.slice(0, 200_000);
  const title = decodeEntities(/<title\b[^<>]*>([^<]*)<\/title>/i.exec(head)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let description = "";
  let themeColor = "";
  for (const t of head.match(/<meta\b[^<>]*>/gi) ?? []) {
    const a = attrs(t);
    const name = (a.name ?? a.property ?? "").toLowerCase();
    if (!description && (name === "description" || name === "og:description")) description = (a.content ?? "").trim();
    if (!themeColor && name === "theme-color" && /^#[0-9a-f]{6}$/i.test(a.content ?? "")) themeColor = a.content.toUpperCase();
  }
  const htmlTag = /<html\b[^<>]*>/i.exec(head)?.[0] ?? "";
  const lang = (/^[a-zA-Z]{2}(?:[-_][a-zA-Z]{2})?/.exec((attrs(htmlTag).lang ?? "").trim())?.[0] ?? "").replace("_", "-");
  return {
    url,
    title,
    description,
    lang,
    themeColor,
    jsonLd: jsonLdBlocks(html),
    text: pageText(html),
    links: collectLinks(html, url),
    colors: brandColorCandidates(html)
  };
}

/** «es-ES», «es», «en_US»… → idioma admitido por el Publicador (o null). */
export function mapLanguage(lang: string | null | undefined): SeoLanguage | null {
  const l = String(lang ?? "").trim().replace("_", "-").toLowerCase();
  if (!l) return null;
  const exact = SEO_LANGUAGES.find((x) => x.toLowerCase() === l);
  if (exact) return exact;
  const base = l.slice(0, 2);
  const byBase: Record<string, SeoLanguage> = { es: "es-ES", en: "en-GB", de: "de-DE", fr: "fr-FR", it: "it-IT", pt: "pt-PT", ca: "ca-ES" };
  if (l === "es-mx" || (base === "es" && /-(mx|ar|co|cl|pe|us)$/.test(l))) return "es-MX";
  if (l === "en-us") return "en-US";
  return byBase[base] ?? null;
}

/** País e idioma de Google (Serper) para cada idioma del Publicador. */
export function serperLocale(language: string): { gl: string; hl: string } {
  const map: Record<string, { gl: string; hl: string }> = {
    "es-ES": { gl: "es", hl: "es" },
    "es-MX": { gl: "mx", hl: "es" },
    "en-GB": { gl: "uk", hl: "en" },
    "en-US": { gl: "us", hl: "en" },
    "de-DE": { gl: "de", hl: "de" },
    "fr-FR": { gl: "fr", hl: "fr" },
    "it-IT": { gl: "it", hl: "it" },
    "pt-PT": { gl: "pt", hl: "pt" },
    "ca-ES": { gl: "es", hl: "ca" }
  };
  return map[language] ?? { gl: "es", hl: "es" };
}

const SKIP_PATH =
  /(wp-admin|wp-login|wp-json|xmlrpc|\/feed\b|\/tag\/|\/author\/|\/category\/|\/categoria\/|\/page\/\d|[?&](s|p|add-to-cart|replytocom)=|\/cart|\/carrito|\/checkout|\/finalizar-compra|\/mi-cuenta|\/my-account|privacidad|privacy|cookie|aviso-legal|legal-notice|politica|policy|condiciones|terminos|terms|\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?)$)/i;
const ARTICLE_PATH = /\/(blog|noticias|news|articulos|actualidad|novedades)\/[^/]+/i;
const HINTS: Array<[RegExp, number]> = [
  [/(sobre|nosotros|quienes|quiénes|empresa|about|historia|equipo|conocenos|conócenos|filosofia)/i, 6],
  [/(servicio|services|producto|products|catalogo|catálogo|soluciones|que-hacemos|qué hacemos|trabajos|proyectos|tienda)/i, 5],
  [/(faq|preguntas|garantia|garantía|como-trabajamos|cómo trabajamos|proceso|instalacion|instalación|medicion|medición|zona|donde|dónde|opiniones|testimonios)/i, 4],
  [/(contact|presupuesto|cita|reserva|pide|solicita|llámanos|llamanos)/i, 3]
];

function langPrefix(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  return /^[a-z]{2}(-[a-z]{2})?$/i.test(seg) ? seg.toLowerCase() : "";
}

function sameSite(a: string, b: string): boolean {
  const ha = hostOf(a);
  const hb = hostOf(b);
  return !!ha && ha === hb;
}

/**
 * Elige las páginas internas que mejor describen el negocio: «quiénes somos»,
 * servicios/productos, preguntas frecuentes, contacto y las secciones del menú
 * (enlaces repetidos en cabecera y pie). Descarta artículos, legales, carrito,
 * archivos y otras versiones de idioma.
 */
export function pickPages(links: PageLink[], homeUrl: string, max = 6): string[] {
  let home: URL;
  try {
    home = new URL(homeUrl);
  } catch {
    return [];
  }
  const homePrefix = langPrefix(home.pathname);
  const homeKey = home.toString().replace(/\/+$/, "");
  const scored: Array<{ url: string; score: number }> = [];
  for (const l of links) {
    if (!sameSite(l.url, homeUrl)) continue;
    const u = new URL(l.url);
    const key = u.toString().replace(/\/+$/, "");
    if (key === homeKey || u.pathname === "/" || SKIP_PATH.test(u.pathname + u.search) || ARTICLE_PATH.test(u.pathname)) continue;
    const prefix = langPrefix(u.pathname);
    if (prefix !== homePrefix && (prefix || homePrefix)) continue;
    if (u.search) continue;
    let path = u.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* ruta con % mal formado: se usa tal cual */
    }
    const hay = `${path} ${l.text}`;
    let score = 0;
    for (const [re, pts] of HINTS) if (re.test(hay)) score = Math.max(score, pts);
    const depth = u.pathname.split("/").filter(Boolean).length - (homePrefix ? 1 : 0);
    if (l.count >= 2) score += 2;
    if (depth <= 1) score += 1;
    else if (depth > 2) score -= 2;
    if (score > 0) scored.push({ url: u.toString(), score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  for (const s of scored) {
    if (out.length >= max) break;
    if (!out.includes(s.url)) out.push(s.url);
  }
  return out;
}

/** Enlaces internos que sirven de destino para la llamada a la acción (contacto, presupuesto…). */
export function ctaCandidates(links: PageLink[], homeUrl: string, max = 12): PageLink[] {
  let homePrefix = "";
  try {
    homePrefix = langPrefix(new URL(homeUrl).pathname);
  } catch {
    return [];
  }
  const byUrl = new Map<string, PageLink>();
  for (const l of links) {
    if (!sameSite(l.url, homeUrl) || byUrl.has(l.url)) continue;
    if (langPrefix(new URL(l.url).pathname) !== homePrefix) continue;
    if (!/(contact|presupuesto|cita|reserva|pide|solicita|llama|whatsapp|tienda|comprar|shop)/i.test(`${l.url} ${l.text}`)) continue;
    byUrl.set(l.url, l);
  }
  return [...byUrl.values()].slice(0, max);
}

const NOT_COMPETITOR =
  /(^|\.)(google|youtube|facebook|instagram|tiktok|pinterest|linkedin|twitter|x|wikipedia|wikiwand|amazon|ebay|aliexpress|temu|shein|milanuncios|wallapop|idealista|fotocasa|paginasamarillas|paginas-amarillas|yelp|tripadvisor|cylex|infoisinfo|tuugo|guiaempresa|einforma|axesor|empresite|habitissimo|cronoshare|starofservice|houzz|europages|kompass|infobel|hotfrog|top-rated|trustpilot|reddit|quora|forocoches|elmundo|elpais|abc|diariosur|20minutos|europapress|lavanguardia|elconfidencial|xataka|ocu|boe|gob|gov|europa|apple|microsoft|canva)\./i;

/** Dominios candidatos a competidor a partir de los resultados de Google (sin el propio, redes ni directorios). */
export function competitorCandidates(
  results: Array<{ link: string; title: string; snippet: string; position: number }>,
  ownUrl: string,
  max = 20
): Array<{ host: string; hits: number; best: number; title: string; snippet: string }> {
  const own = hostOf(ownUrl);
  const byHost = new Map<string, { host: string; hits: number; best: number; title: string; snippet: string }>();
  for (const r of results) {
    const h = hostOf(r.link);
    if (!h || h === own || (own && (h.endsWith(`.${own}`) || own.endsWith(`.${h}`)))) continue;
    if (NOT_COMPETITOR.test(`.${h}`) || /\.(gob|gov|edu)(\.|$)/.test(h)) continue;
    const prev = byHost.get(h);
    if (prev) {
      prev.hits++;
      prev.best = Math.min(prev.best, r.position);
    } else byHost.set(h, { host: h, hits: 1, best: r.position, title: r.title.slice(0, 120), snippet: r.snippet.slice(0, 200) });
  }
  return [...byHost.values()].sort((a, b) => b.hits - a.hits || a.best - b.best).slice(0, max);
}

/** «https://www.ejemplo.com/x», «ejemplo.com» → «ejemplo.com». */
export function normalizeDomain(value: string): string {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return "";
  const h = hostOf(/^https?:\/\//.test(v) ? v : `https://${v}`);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : "";
}
