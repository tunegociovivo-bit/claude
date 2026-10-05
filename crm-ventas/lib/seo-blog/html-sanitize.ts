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
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript|textarea|select|svg|math|frameset|frame|applet)\b[\s\S]*?<\/\1\s*>/gi;
const DROP_OPEN = /<\/?(script|style|iframe|object|embed|template|noscript|textarea|select|svg|math|frameset|frame|applet|base|meta|link)\b[^>]*>/gi;

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

export function sanitizePreviewHtml(html: string): string {
  return String(html ?? "")
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(DROP_WITH_CONTENT, "")
    .replace(DROP_OPEN, "")
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (_m, slash: string, name: string, attrs: string) => cleanTag(!!slash, name, attrs))
    .replace(/<(?![a-zA-Z/])/g, "&lt;");
}
