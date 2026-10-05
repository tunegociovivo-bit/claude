/**
 * Saneado por lista blanca del HTML de la vista previa (se pinta con
 * dangerouslySetInnerHTML dentro del CRM). No afecta al HTML que se envía a
 * WordPress. Función pura: testeada en tests/seo-blog.test.ts.
 */

const ALLOWED_TAGS = new Set([
  "a", "b", "blockquote", "br", "caption", "code", "dd", "details", "div", "dl", "dt", "em", "figcaption", "figure",
  "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "mark", "nav", "ol", "p", "pre", "s", "small", "span",
  "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"
]);
/** Etiquetas cuyo contenido completo se elimina. */
const DROP_NAMES = "script|style|iframe|object|embed|template|noscript|textarea|select|svg|math|frameset|frame|applet";
const DROP_OPEN = /<\/?(script|style|iframe|object|embed|template|noscript|textarea|select|svg|math|frameset|frame|applet|base|meta|link)\b[^<>]*>/gi;

/**
 * Quita `<script>…</script>` y similares en tiempo lineal: cada apertura busca
 * su cierre con indexOf y, si un nombre ya no tiene cierre más adelante, no se
 * vuelve a buscar (un contenido malicioso con miles de aperturas sin cierre no
 * bloquea el proceso).
 */
function dropWithContent(html: string): string {
  const lower = html.toLowerCase();
  const open = new RegExp(`<(${DROP_NAMES})\\b`, "gi");
  const noCloseAfter = new Map<string, number>();
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    const name = m[1].toLowerCase();
    const from = m.index;
    if ((noCloseAfter.get(name) ?? Infinity) <= from) continue;
    const close = lower.indexOf(`</${name}`, from + 1);
    if (close < 0) {
      noCloseAfter.set(name, from);
      continue;
    }
    const end = lower.indexOf(">", close);
    if (end < 0) {
      noCloseAfter.set(name, from);
      continue;
    }
    out += html.slice(last, from);
    last = end + 1;
    open.lastIndex = last;
  }
  return out + html.slice(last);
}

const GLOBAL_ATTRS = new Set(["class", "id", "title", "aria-label", "lang", "dir"]);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading", "decoding"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  ol: new Set(["start", "type"]),
  details: new Set(["open"])
};

function decodeAttr(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d) || 32))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;|&newline;/gi, "")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function escAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Solo http(s), mailto, tel, anclas y rutas relativas. */
export function safeUrl(raw: string): string | null {
  const v = decodeAttr(raw).replace(/[\u0000- \u007f-\u009f]+/g, "");
  if (!v) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!scheme) return v;
  return ["http", "https", "mailto", "tel"].includes(scheme[1].toLowerCase()) ? v : null;
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function cleanTag(closing: boolean, name: string, attrs: string): string {
  const tag = name.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return "";
  if (closing) return tag === "br" || tag === "hr" || tag === "img" ? "" : `</${tag}>`;
  const allowed = TAG_ATTRS[tag];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of attrs.matchAll(ATTR_RE)) {
    const key = m[1].toLowerCase();
    if (seen.has(key) || !(GLOBAL_ATTRS.has(key) || allowed?.has(key))) continue;
    seen.add(key);
    const hasValue = m[2] !== undefined || m[3] !== undefined || m[4] !== undefined;
    let value = m[2] ?? m[3] ?? m[4] ?? "";
    if (key === "href" || key === "src") {
      const u = safeUrl(value);
      if (u === null) continue;
      value = u;
    } else {
      value = decodeAttr(value);
    }
    if (key === "target") value = value === "_blank" ? "_blank" : "_self";
    out.push(hasValue || key !== "open" ? `${key}="${escAttr(value)}"` : key);
  }
  if (tag === "a" && seen.has("target")) {
    const i = out.findIndex((x) => x.startsWith("rel="));
    if (i >= 0) out.splice(i, 1);
    out.push('rel="noopener noreferrer"');
  }
  return `<${tag}${out.length ? " " + out.join(" ") : ""}>`;
}

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;

function escText(v: string): string {
  return v.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Tokeniza una sola vez: lo que tiene forma de etiqueta pasa por la lista
 * blanca y TODO lo demás se emite como texto escapado. Así, al quitar una
 * etiqueta no permitida, los trozos de alrededor no pueden unirse para formar
 * una etiqueta nueva (p. ej. `<<x>img onerror=…>`).
 */
export function sanitizePreviewHtml(html: string): string {
  const withoutComments = String(html ?? "").replace(/<!--[\s\S]*?(-->|$)/g, "");
  const src = dropWithContent(withoutComments).replace(DROP_OPEN, "");
  let out = "";
  let last = 0;
  for (const m of src.matchAll(TAG_RE)) {
    out += escText(src.slice(last, m.index));
    out += cleanTag(!!m[1], m[2], m[3]);
    last = (m.index ?? 0) + m[0].length;
  }
  out += escText(src.slice(last));
  return out;
}
