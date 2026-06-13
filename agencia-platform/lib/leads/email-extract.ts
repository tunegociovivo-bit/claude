/**
 * Extracción de emails de contacto desde la WEB de un negocio.
 *
 * Google Places/GMB no expone el email, pero casi todas las webs publican uno
 * de contacto (home, /contacto, aviso legal). Aquí lo sacamos: bajamos esas
 * páginas y extraemos las direcciones, priorizando las del propio dominio y
 * descartando ruido (CDNs, imágenes, ejemplos). Son emails de empresa
 * publicados para contacto (interés legítimo B2B); respeta siempre el opt-out.
 */

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
const JUNK = /(sentry|wixpress|example\.com|\.png|\.jpg|\.jpeg|\.gif|\.webp|@2x|@3x|godaddy|cloudflare|@sentry|domain\.com|email\.com|tu-?dominio)/i;

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
    return (await resp.text()).slice(0, 500_000);
  } catch {
    return "";
  }
}

/**
 * Extrae emails de contacto de una web. Prueba home + páginas típicas de
 * contacto/aviso legal. Devuelve los emails del propio dominio primero.
 */
export async function extractEmailsFromWebsite(website: string): Promise<string[]> {
  const domain = domainOf(website);
  if (!domain) return [];
  const base = `https://${domain}`;
  const pages = [base, `${base}/contacto`, `${base}/contact`, `${base}/aviso-legal`, `${base}/contacto/`, `${base}/es/contacto`];

  const found = new Set<string>();
  for (const p of pages) {
    if (found.size >= 6) break;
    const html = await fetchText(p);
    if (!html) continue;
    // mailto: primero (más fiable), luego texto plano.
    const hay = html;
    for (const m of hay.matchAll(/mailto:([^"'?>\s]+)/gi)) addEmail(found, m[1]);
    for (const m of hay.matchAll(EMAIL_RE)) addEmail(found, m[0]);
  }

  // Prioriza los del propio dominio.
  const all = Array.from(found);
  const own = all.filter((e) => e.endsWith(`@${domain}`));
  const rest = all.filter((e) => !e.endsWith(`@${domain}`));
  return [...own, ...rest].slice(0, 8);
}

function addEmail(set: Set<string>, raw: string) {
  const e = raw.trim().toLowerCase().replace(/^mailto:/, "").replace(/[).,;]+$/, "");
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)) return;
  if (JUNK.test(e)) return;
  set.add(e);
}
