/**
 * Edición de la sección «Preguntas frecuentes» del cuerpo HTML. El schema FAQPage
 * se genera a partir de esta sección (extractFaq), así que editar la FAQ reescribe
 * la sección visible y ambos quedan siempre iguales (requisito de Google).
 * Funciones puras: testeadas en tests/seo-blog.test.ts.
 */

const FAQ_H2 = /<h2[^>]*>\s*(?:preguntas frecuentes|faq|frequently asked questions|häufige fragen)[^<]*<\/h2>/iu;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function faqTitle(lang: string): string {
  if (lang.startsWith("en")) return "Frequently asked questions";
  if (lang.startsWith("de")) return "Häufige Fragen";
  return "Preguntas frecuentes";
}

export function renderFaq(items: { q: string; a: string }[]): string {
  return items
    .map((x) => ({ q: x.q.trim(), a: x.a.trim() }))
    .filter((x) => x.q && x.a)
    .map((x) => `<h3>${esc(x.q)}</h3>\n<p>${esc(x.a)}</p>`)
    .join("\n");
}

/** Sustituye (o crea / elimina si `items` está vacío) la sección FAQ del contenido. */
export function replaceFaqSection(html: string, items: { q: string; a: string }[], lang = "es-ES"): string {
  const src = String(html ?? "");
  const body = renderFaq(items);
  const m = FAQ_H2.exec(src);
  if (!m) {
    if (!body) return src;
    return `${src.trimEnd()}\n<h2>${faqTitle(lang)}</h2>\n${body}`;
  }
  const start = m.index;
  const afterH2 = start + m[0].length;
  const nextH2 = src.slice(afterH2).search(/<h2[\s>]/i);
  const end = nextH2 < 0 ? src.length : afterH2 + nextH2;
  const replacement = body ? `${m[0]}\n${body}\n` : "";
  return src.slice(0, start) + replacement + src.slice(end);
}
