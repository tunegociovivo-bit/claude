/**
 * Extracción de emails de contacto desde la WEB de un negocio.
 *
 * Google Places/GMB no expone el email, pero casi todas las webs publican uno
 * de contacto (home, /contacto, aviso legal, privacidad). Aquí lo sacamos:
 *   1) bajamos la home,
 *   2) DESCUBRIMOS en ella los enlaces a contacto/legal/privacidad (rutas no
 *      estándar incluidas — clave en webs de empresas grandes),
 *   3) bajamos esas páginas + un set de rutas típicas,
 *   4) extraemos direcciones (mailto, texto y OFUSCADAS tipo "info [at] x.com"),
 *      priorizando las del propio dominio y las de buzones de contacto.
 * Que un email sea público no autoriza por sí solo una comunicación comercial:
 * la política de envío y el opt-out se aplican en la capa de cadencia.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
const JUNK = /(sentry|wixpress|example\.com|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|@2x|@3x|godaddy|cloudflare|@sentry|domain\.com|email\.com|tu-?dominio|yourdomain|wordpress|squarespace|\.webflow)/i;

// Buzones de contacto que priorizamos (más útiles que un email personal suelto).
const ROLE_PREFIXES = [
  "info", "contacto", "contact", "hola", "hello", "marketing", "comunicacion",
  "comunicación", "prensa", "press", "rrhh", "talento", "empleo", "ventas",
  "sales", "comercial", "administracion", "administración", "privacy", "privacidad",
  "dpo", "legal", "lopd", "atencioncliente", "clientes", "soporte"
];

// Palabras que delatan un enlace a página de contacto/legal en la home.
const CONTACT_LINK = /contact|contacto|contacta|aviso.?legal|legal|privac|nosotros|qui[eé]nes|about|empresa|company|corporate|impressum|help|ayuda|soporte|prensa|press|trabaja|empleo|careers?/i;

function domainOf(url: string): string | null {
  try {
    const u = new URL(/^https?:/.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function parseIpv6(address: string): number[] | null {
  let value = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const ipv4Tail = value.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const octets = ipv4Tail.split(".").map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    value = value.slice(0, -ipv4Tail.length) + `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.flatMap((group) => {
    const word = Number.parseInt(group, 16);
    return [word >> 8, word & 0xff];
  });
}

export function isPrivateIp(address: string): boolean {
  const clean = address.replace(/^\[|\]$/g, "");
  if (isIP(clean) === 4) {
    const [a, b, c] = clean.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  const bytes = parseIpv6(clean);
  if (!bytes) return true;
  const embeddedV4 = (offset: number) => `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return isPrivateIp(embeddedV4(12));
  // Direcciones IPv4-compatible (::/96) pueden alcanzar IPv4 local según la pila.
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return true;
  // NAT64 well-known 64:ff9b::/96: inspecciona el IPv4 embebido.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((byte) => byte === 0)) return isPrivateIp(embeddedV4(12));
  // 6to4 incluye IPv4 en los bytes 2..5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02 && isPrivateIp(embeddedV4(2))) return true;
  return (bytes[0] & 0xfe) === 0xfc || (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
    bytes[0] === 0xff || (bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2] === 0x0d && bytes[3] === 0xb8 || bytes[2] === 0 && bytes[3] === 0)) ||
    (bytes[0] === 0x01 && bytes.slice(1, 8).every((byte) => byte === 0));
}

async function assertPublicWebUrl(raw: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported_protocol");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error("private_host");
  }
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) throw new Error("private_host");
  const selected = addresses[0];
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

const MAX_HTML_BYTES = 800_000;

/**
 * Petición HTTP con la resolución DNS ya validada fijada en `lookup`. Así el
 * socket no puede resolver de nuevo el dominio hacia una IP privada (rebinding).
 * El cuerpo se consume como stream y se corta antes de superar el límite.
 */
async function requestText(target: { url: URL; address: string; family: 4 | 6 }): Promise<{ status: number; location: string | null; contentType: string; text: string }> {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === "https:" ? https : http;
    const req = transport.request(target.url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NegocioVivoBot/1.0)", Accept: "text/html" },
      lookup: ((_: string, options: any, callback: any) => {
        if (options?.all) callback(null, [{ address: target.address, family: target.family }]);
        else callback(null, target.address, target.family);
      }) as any
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      const contentType = String(res.headers["content-type"] ?? "");
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > MAX_HTML_BYTES) {
        res.destroy();
        reject(new Error("response_too_large"));
        return;
      }
      if ((status >= 300 && status < 400) || status < 200 || status >= 400) {
        res.resume();
        resolve({ status, location, contentType, text: "" });
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > MAX_HTML_BYTES) {
          res.destroy(new Error("response_too_large"));
          return;
        }
        chunks.push(buffer);
      });
      res.on("end", () => resolve({ status, location, contentType, text: Buffer.concat(chunks, total).toString("utf8") }));
      res.on("error", reject);
    });
    req.setTimeout(8000, () => req.destroy(new Error("request_timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function fetchText(initialUrl: string, allowedDomain?: string): Promise<string> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect++) {
    if (allowedDomain && domainOf(current) !== allowedDomain) return "";
    const target = await assertPublicWebUrl(current);
    const response = await requestText(target);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) return "";
      const next = new URL(response.location, target.url).toString();
      if (allowedDomain && domainOf(next) !== allowedDomain) return "";
      current = next;
      continue;
    }
    if (response.status === 429 || response.status >= 500) throw new Error(`transient_http_${response.status}`);
    if (response.status < 200 || response.status >= 300) return "";
    if (response.contentType && !/text|html/i.test(response.contentType)) return "";
    return response.text;
  }
  throw new Error("too_many_redirects");
}

/** Descubre en el HTML de la home los enlaces internos a contacto/legal/etc. */
function discoverContactLinks(html: string, base: string, domain: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ");
    if (!CONTACT_LINK.test(href) && !CONTACT_LINK.test(text)) continue;
    let abs: string | null = null;
    try {
      abs = new URL(href, base).toString();
    } catch {
      abs = null;
    }
    if (!abs) continue;
    // Solo enlaces del mismo dominio (evita irnos a redes sociales/terceros).
    if (domainOf(abs) !== domain) continue;
    out.add(abs.split("#")[0]);
    if (out.size >= 8) break;
  }
  return [...out];
}

/** Convierte emails ofuscados ("info [at] x [dot] com") a texto normal. */
function deobfuscate(html: string): string {
  return html
    .replace(/\s*\(\s*at\s*\)\s*|\s*\[\s*at\s*\]\s*|\s+at\s+|\s*\barroba\b\s*/gi, "@")
    .replace(/\s*\(\s*dot\s*\)\s*|\s*\[\s*dot\s*\]\s*|\s+dot\s+|\s*\bpunto\b\s*/gi, ".");
}

/**
 * Extrae emails de contacto de una web. Home + páginas de contacto descubiertas
 * + rutas típicas. Devuelve los del propio dominio y buzones de contacto primero.
 */
const SOCIAL_DOMAINS = /(facebook|instagram|twitter|x\.com|linkedin|tiktok|youtube|wa\.me|whatsapp|t\.me|pinterest)\./i;

export type WebsiteEmailCandidate = {
  email: string;
  sourceUrl: string;
  method: "mailto" | "text";
  pageKind: "home" | "contact" | "other";
};

export async function extractEmailsFromWebsite(website: string): Promise<string[]> {
  return (await extractContactsFromWebsite(website)).emailCandidates.map((candidate) => candidate.email);
}

export async function extractEmailCandidatesFromWebsite(website: string): Promise<WebsiteEmailCandidate[]> {
  return (await extractContactsFromWebsite(website)).emailCandidates;
}

/**
 * Recorre la web UNA vez y devuelve emails de contacto Y teléfonos MÓVILES publicados. Los móviles
 * (España: empiezan por 6 o 7) son contacto profesional publicado; los fijos NO se devuelven aquí
 * (el llamante ya suele tener el fijo de Google Places y no cuenta como canal nuevo).
 */
export async function extractContactsFromWebsite(website: string): Promise<{ emails: string[]; mobiles: string[]; emailCandidates: WebsiteEmailCandidate[] }> {
  const domain = domainOf(website);
  if (!domain) return { emails: [], mobiles: [], emailCandidates: [] };
  // Si la "web" es una red social (Places a veces la devuelve), no hay contacto real que extraer.
  if (SOCIAL_DOMAINS.test(domain)) return { emails: [], mobiles: [], emailCandidates: [] };
  let websiteUrl: URL;
  try {
    websiteUrl = new URL(/^https?:/i.test(website) ? website : `https://${website}`);
  } catch {
    return { emails: [], mobiles: [], emailCandidates: [] };
  }
  const origin = websiteUrl.origin;
  const home = websiteUrl.toString();

  const homeHtml = await fetchText(home, domain);
  const discovered = homeHtml ? discoverContactLinks(homeHtml, home, domain) : [];
  const common = [
    `${origin}/contacto`, `${origin}/contact`, `${origin}/contactar`, `${origin}/contact-us`,
    `${origin}/aviso-legal`, `${origin}/legal`, `${origin}/privacidad`, `${origin}/politica-de-privacidad`,
    `${origin}/nosotros`, `${origin}/quienes-somos`, `${origin}/about`, `${origin}/es/contacto`, `${origin}/en/contact`
  ];
  // Home + descubiertas (prioridad) + comunes, deduplicado y acotado.
  const pages = [...new Set([home, ...discovered, ...common])].slice(0, 12);

  const found = new Set<string>();
  const evidence = new Map<string, WebsiteEmailCandidate>();
  const mobiles = new Set<string>();
  const htmls: Array<{ sourceUrl: string; html: string }> = [{ sourceUrl: home, html: homeHtml }];
  let firstTransientError: unknown = null;
  // Cuatro páginas simultáneas como máximo por lead; evita que un lote de webs
  // lentas multiplique sockets y memoria sin límite.
  for (let offset = 1; offset < pages.length; offset += 4) {
    const settled = await Promise.allSettled(pages.slice(offset, offset + 4).map(async (sourceUrl) => ({ sourceUrl, html: await fetchText(sourceUrl, domain) })));
    for (const result of settled) {
      if (result.status === "fulfilled") {
        htmls.push(result.value);
      } else if (!firstTransientError) {
        firstTransientError = result.reason;
      }
    }
  }
  for (const page of htmls) {
    const raw = page.html;
    if (!raw) continue;
    const html = raw + "\n" + deobfuscate(raw);
    const pageKind: WebsiteEmailCandidate["pageKind"] = page.sourceUrl === home
      ? "home"
      : CONTACT_LINK.test(new URL(page.sourceUrl).pathname) ? "contact" : "other";
    for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
      const email = addEmail(found, m[1], domain);
      if (email) evidence.set(email, { email, sourceUrl: page.sourceUrl, method: "mailto", pageKind });
    }
    for (const m of html.matchAll(EMAIL_RE)) {
      const email = addEmail(found, m[0], domain);
      if (email && !evidence.has(email)) evidence.set(email, { email, sourceUrl: page.sourceUrl, method: "text", pageKind });
    }
    for (const m of html.matchAll(/tel:([+\d\s().-]{7,})/gi)) addMobile(mobiles, m[1]);
    for (const m of html.matchAll(ES_PHONE_RE)) addMobile(mobiles, m[0]);
    if (found.size >= 12 && mobiles.size >= 5) break;
  }
  if (!found.size && firstTransientError) throw firstTransientError;

  // Orden: 1) buzón de contacto del propio dominio, 2) resto del dominio,
  // 3) buzón de contacto de otro dominio, 4) el resto.
  const all = [...found];
  const isOwn = (e: string) => (e.split("@")[1] ?? "").endsWith(domain);
  const isRole = (e: string) => ROLE_PREFIXES.includes(e.split("@")[0]);
  const rank = (e: string) => (isOwn(e) ? 0 : 2) + (isRole(e) ? 0 : 1);
  all.sort((a, b) => rank(a) - rank(b));
  const emailCandidates = all.slice(0, 8).map((email) => evidence.get(email) ?? { email, sourceUrl: home, method: "text" as const, pageKind: "home" as const });
  return { emails: emailCandidates.map((candidate) => candidate.email), mobiles: [...mobiles].slice(0, 5), emailCandidates };
}

// Móvil español publicado: opcional +34, luego 6/7 y 8 dígitos más (fijos 8/9 NO se capturan aquí).
const ES_PHONE_RE = /(?:\+?34[\s.-]?)?([67]\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})/g;

/** Normaliza a 9 dígitos y guarda solo móviles españoles (6/7). */
function addMobile(set: Set<string>, raw: string) {
  const digits = raw.replace(/[^\d]/g, "").replace(/^0+/, "").replace(/^34(?=\d{9}$)/, "");
  if (digits.length !== 9) return;
  if (!/^[67]/.test(digits)) return; // solo móviles publicados; fijos fuera
  set.add(digits);
}

/** Normaliza un teléfono español a 9 dígitos (para comparar/deduplicar). */
export function normalizeEsPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "").replace(/^0+/, "").replace(/^34(?=\d{9}$)/, "");
  return digits.length === 9 ? digits : null;
}

function addEmail(set: Set<string>, raw: string, domain: string): string | null {
  const e = raw.trim().toLowerCase().replace(/^mailto:/, "").replace(/[).,;:]+$/, "");
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)) return null;
  if (JUNK.test(e)) return null;
  // Descarta imágenes/hashes con @ que pasan el regex por casualidad.
  if (e.length > 70) return null;
  set.add(e);
  return e;
}
