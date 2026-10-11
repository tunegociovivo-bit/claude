/**
 * Publicar respuestas en Meta sin activar su filtro antispam.
 *
 * Meta bloquea respuestas con "Breaking Browser Locker Behavior detected" (y
 * variantes de "abusive"/"spam") cuando una página publica en ráfaga muchas
 * respuestas casi iguales con un enlace ACORTADO que redirige a otro dominio:
 * es el patrón de las estafas de "browser locker". Aquí:
 *  - se sustituyen los enlaces acortados por su destino final real;
 *  - se reconocen los bloqueos de integridad para no reintentarlos (cada
 *    reintento agrava la restricción de la página).
 */

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?…]+$/;

// Acortadores conocidos y de marca. Cualquier host de ≤ 8 caracteres con una
// ruta corta también se trata como posible acortador (p. ej. eros.ki/xxxx).
const KNOWN_SHORTENERS = new Set([
  "bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "buff.ly", "is.gd", "cutt.ly", "rebrand.ly",
  "shorturl.at", "tiny.cc", "lnkd.in", "fb.me", "s.id", "rb.gy", "t.ly", "bl.ink", "short.io", "linktr.ee"
]);

export function looksLikeShortLink(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (KNOWN_SHORTENERS.has(host)) return true;
    const path = url.pathname.replace(/\/+$/, "");
    return host.replace(/\./g, "").length <= 8 && /^\/[A-Za-z0-9_-]{3,12}$/.test(path) && !url.search;
  } catch {
    return false;
  }
}

function isPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    // Nunca seguir redirecciones hacia la red interna.
    return !(host === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith(".internal") || host.includes(":"));
  } catch {
    return false;
  }
}

/** Sigue redirecciones (máx. 5) y devuelve la URL final, o null si no se puede. */
export async function resolveFinalUrl(raw: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let current = raw;
  for (let hop = 0; hop < 5; hop++) {
    if (!isPublicHttpUrl(current)) return null;
    let response: Response;
    try {
      response = await fetchImpl(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (compatible; NegocioVivoHub/1.0)" } });
    } catch {
      return hop === 0 ? null : current;
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return hop === 0 ? null : current;
  }
  return current;
}

/** Sustituye los enlaces acortados del mensaje por su destino final. */
export async function expandShortLinks(message: string, fetchImpl: typeof fetch = fetch): Promise<{ message: string; replaced: Array<{ from: string; to: string }> }> {
  const replaced: Array<{ from: string; to: string }> = [];
  const found = [...new Set((message.match(URL_RE) ?? []).map((url) => url.replace(TRAILING_PUNCTUATION, "")))];
  let out = message;
  for (const link of found) {
    if (!looksLikeShortLink(link)) continue;
    const finalUrl = await resolveFinalUrl(link, fetchImpl);
    if (!finalUrl || finalUrl === link) continue;
    out = out.split(link).join(finalUrl);
    replaced.push({ from: link, to: finalUrl });
  }
  return { message: out, replaced };
}

/** ¿Es un bloqueo antispam/integridad de Meta (no un fallo temporal)? */
export function isMetaIntegrityBlock(error: { message?: string; code?: number } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 368) return true;
  return /browser locker|deemed abusive|abusive or is otherwise disallowed|spam|temporarily (restricted|blocked)|you('|’)re temporarily|restringid|bloquead/i.test(error.message ?? "");
}

export const META_INTEGRITY_BLOCK_HELP =
  "Meta ha frenado la respuesta con su filtro antispam (muchas respuestas parecidas con enlace en poco tiempo). Si llevaba un enlace acortado, ya se reintentó una vez con el enlace completo. Espera unos minutos antes de publicar más: insistir alarga la restricción.";

export class MetaIntegrityBlockError extends Error {
  constructor(readonly metaMessage: string) { super(`${META_INTEGRITY_BLOCK_HELP} (Meta: ${metaMessage})`); this.name = "MetaIntegrityBlockError"; }
}

/**
 * Publica la respuesta tal cual (con el enlace acortado). Solo si Meta la
 * frena por antispam, se reintenta UNA vez con los enlaces acortados
 * sustituidos por su destino final. Si vuelve a frenarla, se para.
 */
export async function publishWithShortLinkFallback(
  draft: string,
  publish: (message: string) => Promise<string>,
  options: { expand?: (message: string) => Promise<{ message: string; replaced: Array<{ from: string; to: string }> }>; waitMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<{ replyId: string; message: string; expanded: boolean }> {
  try {
    return { replyId: await publish(draft), message: draft, expanded: false };
  } catch (cause) {
    if (!(cause instanceof MetaIntegrityBlockError)) throw cause;
    const expanded = await (options.expand ?? expandShortLinks)(draft);
    if (!expanded.replaced.length) throw cause; // no había enlace acortado que cambiar
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    await sleep(options.waitMs ?? 5000);
    return { replyId: await publish(expanded.message), message: expanded.message, expanded: true };
  }
}
