/**
 * Datos de marca de un negocio a partir de su web: email de contacto, logo y color principal.
 * Se usa para autorrellenar la página de valoración del GMB Hub.
 *
 *  - Email: el extractor de contactos de leads (home + contacto/legal), buzones del dominio primero.
 *  - Logo: JSON-LD «logo» → <img> con «logo» (cabecera) → og:logo → apple-touch-icon → icono grande
 *          → favicon de Google como último recurso.
 *  - Color: meta theme-color → variables CSS de marca (Elementor, WordPress, Bootstrap, genéricas)
 *           en la home y sus hojas de estilo → color dominante saturado del logo.
 * Todo best-effort: lo que no se encuentre vuelve vacío y el usuario lo completa.
 */
import { lookup } from "node:dns/promises";
import { extractContactsFromWebsite, fetchText, isPrivateIp } from "@/lib/leads/email-extract";

export type BrandInfo = {
  website: string;
  email: string;
  emails: string[];
  logoUrl: string;
  logos: string[];
  color: string;
  colorSource: "" | "theme-color" | "css" | "logo";
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function abs(u: string, base: string): string | null {
  try {
    const v = u.trim().replace(/&amp;/g, "&");
    if (!v || v.startsWith("data:")) return null;
    const r = new URL(v, base);
    return /^https?:$/.test(r.protocol) ? r.toString() : null;
  } catch {
    return null;
  }
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : "";
}

/** Normaliza #abc / #aabbcc / rgb(r,g,b) a #rrggbb. */
export function normHex(c: string): string | null {
  const s = c.trim().toLowerCase();
  if (HEX_RE.test(s)) {
    const h = s.slice(1);
    return "#" + (h.length === 3 ? h.split("").map((x) => x + x).join("") : h);
  }
  const m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
  if (m) return "#" + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
  return null;
}

/** ¿Sirve como color de marca? Descarta blancos, negros y grises. */
export function isBrandish(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  return s >= 0.25 && l > 0.12 && l < 0.9;
}

export function logoCandidates(html: string, base: string): string[] {
  const out: string[] = [];
  const push = (u: string | null) => { if (u && !out.includes(u)) out.push(u); };

  // 1) JSON-LD Organization/LocalBusiness → logo
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const lm of m[1].matchAll(/"logo"\s*:\s*(?:"([^"]+)"|\{[^}]*?"(?:url|contentUrl)"\s*:\s*"([^"]+)")/g)) push(abs((lm[1] ?? lm[2]).replace(/\\\//g, "/"), base));
  }
  // 2) <img> que parecen el logo (clase, id, alt o src con «logo»); los de la cabecera primero.
  const headerEnd = html.search(/<\/header>/i);
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => ({ tag: m[0], idx: m.index ?? 0 }));
  const logoImgs = imgs.filter(({ tag }) => /logo/i.test(attr(tag, "class") + " " + attr(tag, "id") + " " + attr(tag, "alt") + " " + attr(tag, "src")));
  logoImgs.sort((a, b) => Number(headerEnd > 0 && b.idx < headerEnd) - Number(headerEnd > 0 && a.idx < headerEnd) || a.idx - b.idx);
  for (const { tag } of logoImgs.slice(0, 4)) {
    const srcset = attr(tag, "srcset").split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean);
    push(abs(attr(tag, "data-src") || attr(tag, "src") || srcset[srcset.length - 1] || "", base));
  }
  // También logos dentro de un enlace/contenedor con clase «logo» (p. ej. <a class="logo"><img …></a>).
  for (const m of html.matchAll(/class=["'][^"']*logo[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*?<img\b[^>]*>/gi)) {
    const tag = m[0].slice(m[0].lastIndexOf("<img"));
    push(abs(attr(tag, "data-src") || attr(tag, "src"), base));
  }
  // 3) og:logo y apple-touch-icon / iconos grandes
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if (/property=["']og:logo["']/i.test(m[0])) push(abs(attr(m[0], "content"), base));
  const icons = [...html.matchAll(/<link\b[^>]*rel=["'][^"']*(apple-touch-icon|icon)[^"']*["'][^>]*>/gi)].map((m) => {
    const size = Number((attr(m[0], "sizes").match(/(\d+)/) ?? [])[1] ?? (/apple/i.test(m[1]) ? 180 : 32));
    return { href: attr(m[0], "href"), size };
  });
  icons.sort((a, b) => b.size - a.size);
  for (const i of icons) if (i.size >= 96) push(abs(i.href, base));
  const own = domainOf(base);
  const ok = out.filter((u) => !/\.(ico)(\?|$)/i.test(u) && !THIRD_PARTY.test(u) && !/(blanco|white|negativo|footer)/i.test(u.split("/").pop() ?? ""));
  // Primero los del propio dominio (o su CDN de imágenes), luego el resto.
  ok.sort((a, b) => Number(domainOf(b).endsWith(own)) - Number(domainOf(a).endsWith(own)));
  return ok.slice(0, 6);
}

const THIRD_PARTY = /(trustindex|trustpilot|google\.|gstatic|facebook|fbcdn|instagram|tripadvisor|gdpr|cookie|whatsapp|paypal|visa|mastercard|kitdigital|next-?generation|feder|logo-?ue|unión-?europea|union-?europea|ministerio|gobierno|plan-?de-?recuperacion)/i;
const PLACEHOLDER_EMAIL = /^(tu|tuemail|tucorreo|nombre|name|email|correo|ejemplo|example|usuario|user|test)@|@(empresa|ejemplo|example|tudominio|dominio|correo|email)\./i;

const CSS_VARS = [
  "--e-global-color-primary",
  "--e-global-color-accent",
  "--wp--preset--color--primary",
  "--wp--preset--color--accent",
  "--color-primary",
  "--primary-color",
  "--brand-color",
  "--color-brand",
  "--theme-color",
  "--accent-color",
  "--color-accent",
  "--bs-primary",
  "--primary",
  "--accent"
];

export function colorFromCss(css: string): string | null {
  for (const v of CSS_VARS) {
    const re = new RegExp(`${v.replace(/[-]/g, "\\-")}\\s*:\\s*(#[0-9a-fA-F]{3,6}\\b|rgba?\\([^)]*\\))`, "g");
    for (const m of css.matchAll(re)) {
      const hex = normHex(m[1]);
      if (hex && isBrandish(hex)) return hex;
    }
  }
  return null;
}

export function themeColor(html: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/name=["'](theme-color|msapplication-TileColor)["']/i.test(m[0])) continue;
    const hex = normHex(attr(m[0], "content"));
    if (hex && isBrandish(hex)) return hex;
  }
  return null;
}

async function safeImage(url: string): Promise<Buffer | null> {
  try {
    const u = new URL(url);
    const { address } = await lookup(u.hostname);
    if (isPrivateIp(address)) return null;
    const r = await fetch(u, { signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!r.ok || !/image/i.test(r.headers.get("content-type") ?? "")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 0 && buf.length < 5_000_000 ? buf : null;
  } catch {
    return null;
  }
}

/** Color saturado más frecuente del logo (ignora transparentes, blancos, negros y grises). */
async function colorFromLogo(url: string): Promise<string | null> {
  const buf = await safeImage(url);
  if (!buf) return null;
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(buf, { density: 72 }).resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bins = new Map<string, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const hex = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
      if (!isBrandish(hex)) continue;
      const k = `${r >> 4},${g >> 4},${b >> 4}`;
      const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      bins.set(k, e);
    }
    const best = [...bins.values()].sort((a, b) => b.n - a.n)[0];
    if (!best || best.n < 6) return null;
    return "#" + [best.r, best.g, best.b].map((x) => Math.round(x / best.n).toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function domainOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function extractBrand(websiteRaw: string): Promise<BrandInfo> {
  const empty: BrandInfo = { website: "", email: "", emails: [], logoUrl: "", logos: [], color: "", colorSource: "" };
  const raw = (websiteRaw ?? "").trim();
  if (!raw) return empty;
  const website = /^https?:/i.test(raw) ? raw : `https://${raw}`;
  const domain = domainOf(website);
  if (!domain || /(facebook|instagram|tiktok|linktr\.ee|wa\.me|google)\./i.test(domain)) return { ...empty, website };

  const [contacts, html] = await Promise.all([
    extractContactsFromWebsite(website).catch(() => ({ emails: [] as string[] })),
    fetchText(website, domain).catch(() => "")
  ]);
  const emails = contacts.emails.filter((e) => !PLACEHOLDER_EMAIL.test(e)).slice(0, 6);
  const out: BrandInfo = { ...empty, website, emails, email: emails[0] ?? "" };
  if (!html) return out;

  out.logos = logoCandidates(html, website);
  out.logoUrl = out.logos[0] ?? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;

  const tc = themeColor(html);
  if (tc) return { ...out, color: tc, colorSource: "theme-color" };

  // Variables CSS en la home (estilos inline) y en hasta 4 hojas de estilo del propio dominio.
  let c = colorFromCss(html);
  if (!c) {
    const sheets = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)]
      .map((m) => abs(attr(m[0], "href"), website))
      .filter((u): u is string => !!u && domainOf(u).endsWith(domain))
      .sort((a, b) => Number(/elementor|global|style|theme|main/i.test(b)) - Number(/elementor|global|style|theme|main/i.test(a)))
      .slice(0, 4);
    const csss = await Promise.all(sheets.map((s) => fetchCss(s, domain)));
    for (const css of csss) if ((c = colorFromCss(css))) break;
  }
  if (c) return { ...out, color: c, colorSource: "css" };

  for (const logo of out.logos.slice(0, 2)) {
    const lc = await colorFromLogo(logo);
    if (lc) return { ...out, color: lc, colorSource: "logo" };
  }
  return out;
}

async function fetchCss(url: string, domain: string): Promise<string> {
  try {
    const u = new URL(url);
    const { address } = await lookup(u.hostname);
    if (isPrivateIp(address) || !u.hostname.replace(/^www\./, "").endsWith(domain)) return "";
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return "";
    return (await r.text()).slice(0, 800_000);
  } catch {
    return "";
  }
}
