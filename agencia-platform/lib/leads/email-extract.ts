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
 * Son emails de empresa publicados para contacto (interés legítimo B2B);
 * respeta siempre el opt-out.
 */

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

async function fetchText(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NegocioVivoBot/1.0)", Accept: "text/html" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow"
    });
    if (!resp.ok) return "";
    const ct = resp.headers.get("content-type") ?? "";
    if (!/text|html/.test(ct)) return "";
    return (await resp.text()).slice(0, 800_000);
  } catch {
    return "";
  }
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

export async function extractEmailsFromWebsite(website: string): Promise<string[]> {
  const domain = domainOf(website);
  if (!domain) return [];
  // Si la "web" es una red social (Places a veces la devuelve), no hay email
  // de contacto real que extraer.
  if (SOCIAL_DOMAINS.test(domain)) return [];
  const base = `https://${domain}`;

  const homeHtml = await fetchText(base);
  const discovered = homeHtml ? discoverContactLinks(homeHtml, base, domain) : [];
  const common = [
    `${base}/contacto`, `${base}/contact`, `${base}/contactar`, `${base}/contact-us`,
    `${base}/aviso-legal`, `${base}/legal`, `${base}/privacidad`, `${base}/politica-de-privacidad`,
    `${base}/nosotros`, `${base}/quienes-somos`, `${base}/about`, `${base}/es/contacto`, `${base}/en/contact`
  ];
  // Home + descubiertas (prioridad) + comunes, deduplicado y acotado.
  const pages = [...new Set([base, ...discovered, ...common])].slice(0, 12);

  const found = new Set<string>();
  const htmls = await Promise.all(pages.map((p) => fetchText(p)));
  for (const raw of htmls) {
    if (!raw) continue;
    const html = raw + "\n" + deobfuscate(raw);
    for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) addEmail(found, m[1], domain);
    for (const m of html.matchAll(EMAIL_RE)) addEmail(found, m[0], domain);
    if (found.size >= 12) break;
  }

  // Orden: 1) buzón de contacto del propio dominio, 2) resto del dominio,
  // 3) buzón de contacto de otro dominio, 4) el resto.
  const all = [...found];
  const isOwn = (e: string) => (e.split("@")[1] ?? "").endsWith(domain);
  const isRole = (e: string) => ROLE_PREFIXES.includes(e.split("@")[0]);
  const rank = (e: string) => (isOwn(e) ? 0 : 2) + (isRole(e) ? 0 : 1);
  all.sort((a, b) => rank(a) - rank(b));
  return all.slice(0, 8);
}

function addEmail(set: Set<string>, raw: string, domain: string) {
  const e = raw.trim().toLowerCase().replace(/^mailto:/, "").replace(/[).,;:]+$/, "");
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)) return;
  if (JUNK.test(e)) return;
  // Descarta imágenes/hashes con @ que pasan el regex por casualidad.
  if (e.length > 70) return;
  set.add(e);
}
