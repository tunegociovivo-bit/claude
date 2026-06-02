/**
 * Extracción de URLs de imágenes desde el HTML ESTÁTICO de una página, sin
 * navegador headless. Muchas fichas de producto de proveedores (PIM tipo
 * Plytix, catálogos, etc.) YA traen las URLs de imagen en el HTML —en <img
 * src>, og:image o atributos data-* (a veces URL-encoded)—, así que un simple
 * fetch + parseo basta y NO hace falta Browserless.
 */

// Iconos, logos, banderas, sellos, badges y demás "chrome" que NO son producto.
const JUNK_RE =
  /(favicon|apple-icon|android-icon|ms-icon|\/iconos?\/|sprite|placeholder|\bblank\b|\bpixel\b|\b1x1\b|spacer|logo|banderas?|\bflags?\b|sello|badge|certified|gptw|ecovadis|aenor|bunzl|high_viz|loader|spinner|avatar|gravatar)/i;

const IMG_EXT_RE = /\.(jpe?g|png|webp|avif)(\?[^\s"'<>]*)?$/i;

function decodeMaybe(s: string): string {
  try {
    if (/%(3a|2f)/i.test(s)) return decodeURIComponent(s);
  } catch {
    /* malformed → se deja igual */
  }
  return s;
}

function absolutize(u: string, base: string): string | null {
  try {
    return new URL(u, base).href;
  } catch {
    return null;
  }
}

export function extractImagesFromHtml(html: string, baseUrl: string, match?: string) {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const push = (raw: string) => {
    if (!raw) return;
    let u = decodeMaybe(raw.trim());
    // Si dentro hay una URL http(s) embebida (caso data-variable="REF|https%3A..."),
    // quédate solo con esa.
    const emb = u.match(/https?%3a%2f%2f[^\s"'|<>]+/i) || u.match(/https?:\/\/[^\s"'|<>]+/i);
    if (emb) u = decodeMaybe(emb[0]);
    const abs = absolutize(u, baseUrl);
    if (!abs || !/^https?:\/\//i.test(abs)) return;
    if (!IMG_EXT_RE.test(abs)) return;
    if (JUNK_RE.test(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    ordered.push(abs);
  };

  // og:image / twitter:image (suele ser la imagen "oficial" de la ficha).
  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/gi
  )) {
    const c = m[0].match(/content=["']([^"']+)["']/i);
    if (c) push(c[1]);
  }
  const ogImage: string | null = ordered.length ? ordered[0] : null;

  // <link rel="image_src">
  for (const m of html.matchAll(/<link[^>]+rel=["']image_src["'][^>]*>/gi)) {
    const c = m[0].match(/href=["']([^"']+)["']/i);
    if (c) push(c[1]);
  }

  // <img> con src / lazy-loading / srcset.
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    for (const a of ["data-src", "data-lazy-src", "data-original", "data-image", "src"]) {
      const mm = tag.match(new RegExp(a + "=[\"']([^\"']+)[\"']", "i"));
      if (mm) push(mm[1]);
    }
    const ss = tag.match(/srcset=["']([^"']+)["']/i);
    if (ss) {
      const first = ss[1].split(",")[0]?.trim().split(/\s+/)[0];
      if (first) push(first);
    }
  }

  // URLs http(s) a imágenes sueltas en cualquier parte del HTML (href de zoom,
  // atributos data-* con la URL codificada, JSON embebido, etc.).
  for (const m of html.matchAll(
    /https?(?::|%3a)(?:\/\/|%2f%2f)[^\s"'|<>)]+?\.(?:jpe?g|png|webp|avif)/gi
  )) {
    push(m[0]);
  }

  // Si se pasó "match" (p.ej. la referencia/SKU), prioriza las imágenes cuyo
  // nombre de archivo lo contenga.
  let matched: string[] = [];
  if (match) {
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const key = norm(match);
    if (key) {
      matched = ordered.filter((u) => {
        const file = (u.split("/").pop() || "").split("?")[0];
        let dec = file;
        try {
          dec = decodeURIComponent(file);
        } catch {
          /* noop */
        }
        return norm(dec).includes(key);
      });
    }
  }

  return { images: ordered, matched, ogImage, count: ordered.length };
}

export async function extractImages(
  url: string,
  opts: { match?: string; timeoutMs?: number } = {}
) {
  const ctrl = new AbortController();
  const timeout = Math.min(Math.max(opts.timeoutMs ?? 20000, 3000), 30000);
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const html = await resp.text();
    const res = extractImagesFromHtml(html, url, opts.match);
    return { ok: resp.ok, status: resp.status, ...res };
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`extractImages timeout tras ${timeout}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
