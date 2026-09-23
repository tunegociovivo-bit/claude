/**
 * Auditoría SEO on-page determinista + utilidades de montaje (índice, FAQ, schema).
 * Funciones puras: testeadas en lib/seo-blog/__tests__/seo.test.ts
 */
import { asArray, decodeEntities, hostOf, plainText, removeAccents, slugify, wordCount } from "./util";

export const AI_TELLS_ES = [
  "en el mundo actual", "en la era digital", "hoy en día más que nunca", "sin lugar a dudas", "cabe destacar",
  "es importante destacar", "es importante señalar", "es importante tener en cuenta", "en conclusión", "en resumen,",
  "en definitiva", "adentrarnos", "sumergirnos", "desbloquear", "llevar al siguiente nivel", "un sinfín de",
  "una amplia gama de", "juega un papel crucial", "juega un papel fundamental", "vamos a explorar",
  "a lo largo de este artículo", "alguna vez te has preguntado", "esperamos que este artículo", "sigue leyendo",
  "en este artículo veremos", "en este artículo te contamos", "holístic", "sinergia", "navegar por el"
];
export const AI_TELLS_EN = [
  "in today's world", "digital age", "delve", "dive into", "unlock", "unleash", "tapestry", "game-changer",
  "it's important to note", "in conclusion", "embark on", "navigate the landscape", "seamless"
];

const STOP = new Set(["de", "la", "el", "en", "y", "a", "los", "las", "del", "para", "por", "con", "un", "una", "que", "the", "of", "and", "for", "in", "to", "se", "al", "mas", "o"]);

export function norm(s: string): string {
  return removeAccents(plainText(s).toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function kwTokens(kw: string): string[] {
  return norm(kw).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
}

/** true si la keyword aparece literal o con todos sus términos significativos. */
export function kwIn(kw: string, text: string): boolean {
  const n = ` ${norm(text)} `;
  if (n.includes(` ${norm(kw)} `)) return true;
  const tokens = kwTokens(kw);
  if (!tokens.length) return false;
  return tokens.every((t) => n.includes(" " + (t.length > 4 ? t.slice(0, -1) : t)));
}

/** Nº de apariciones de la keyword permitiendo hasta 2 palabras intercaladas. */
export function kwOccurrences(kw: string, text: string): number {
  const words = norm(kw).split(" ").filter(Boolean);
  if (!words.length) return 0;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<=\\s)${words.map(esc).join("(?:\\s+\\S+){0,2}?\\s+")}(?=\\s)`, "gu");
  return (` ${norm(text)} `.match(re) ?? []).length;
}

export type SeoCheck = { id: string; w: number; ok: boolean; label: string; fix: string };
export type SeoReport = {
  score: number;
  checks: SeoCheck[];
  issues: string[];
  stats: {
    words: number; density: number; occurrences: number; h2: number; h3: number; internal: number; external: number;
    faq: number; avgSentence: number; readingMinutes: number;
  };
};

export function extractFaq(html: string): { q: string; a: string }[] {
  const m = /<h2[^>]*>\s*(?:preguntas frecuentes|faq|frequently asked questions|häufige fragen)[^<]*<\/h2>([\s\S]*)$/iu.exec(html ?? "");
  if (!m) return [];
  const block = m[1].split(/<h2/i)[0];
  const out: { q: string; a: string }[] = [];
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|$)/gi;
  let x: RegExpExecArray | null;
  while ((x = re.exec(block))) {
    const q = plainText(x[1]);
    const a = plainText(x[2]);
    if (q && a) out.push({ q, a });
  }
  return out;
}

export function analyze(
  p: { content: string | null; keyword: string; title: string; slug: string; metaTitle: string; metaDescription: string; brief: any },
  site: { siteUrl: string; language: string; wordsMin: number }
): SeoReport {
  const html = String(p.content ?? "");
  const kw = p.keyword;
  const brief = p.brief ?? {};
  const text = plainText(html);
  const words = wordCount(html);
  const first100 = text.split(/\s+/u).slice(0, 100).join(" ");

  const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1]);
  const h3 = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => m[1]);
  const links = [...html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const siteHost = hostOf(site.siteUrl);
  let internal = 0;
  let external = 0;
  for (const u of links) {
    const h = u.startsWith("/") || u.startsWith("#") ? "" : hostOf(u);
    if (!h || (siteHost && h === siteHost)) internal++;
    else external++;
  }

  const occ = kwOccurrences(kw, text);
  const kwLen = Math.max(1, norm(kw).split(" ").length);
  const density = words ? Math.round(((occ * kwLen) / words) * 10000) / 100 : 0;

  const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]);
  const longP = ps.filter((x) => wordCount(x) > 110).length;
  const sentences = text.split(/(?<=[.!?])\s+/u).filter((s) => s.trim().length > 2);
  const avgSentence = sentences.length ? Math.round((words / sentences.length) * 10) / 10 : 0;

  const sm = /<\/h2>\s*(?:<!--[^>]*-->\s*)*<p[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  const snippetWords = sm ? wordCount(sm[1]) : 0;

  const faq = extractFaq(html);
  const tells = site.language.startsWith("es") ? AI_TELLS_ES : AI_TELLS_EN;
  const low = text.toLowerCase();
  const foundTells = tells.filter((t) => low.includes(t));
  const emdash = (text.match(/—/g) ?? []).length;

  const altKw = asArray<any>(brief.images).some((i) => kwIn(kw, String(i?.alt ?? "")));
  const h2Kw = h2.some((h) => kwIn(kw, h));
  const mt = p.metaTitle ?? "";
  const md = p.metaDescription ?? "";
  const min = site.wordsMin || 1000;

  const checks: SeoCheck[] = [
    { id: "kw_title", w: 10, ok: kwIn(kw, mt), label: "Keyword en el meta title", fix: `Incluye la keyword «${kw}» en el meta title, preferiblemente al inicio.` },
    { id: "title_len", w: 5, ok: mt.length >= 30 && mt.length <= 60, label: `Meta title 30–60 caracteres (${mt.length})`, fix: "Ajusta el meta title a 30–60 caracteres." },
    { id: "desc", w: 8, ok: md.length >= 120 && md.length <= 160 && kwIn(kw, md), label: `Meta description 120–160 car. con keyword (${md.length})`, fix: "Reescribe la meta description: 140–155 caracteres, con la keyword y un beneficio claro." },
    { id: "h1", w: 5, ok: kwIn(kw, p.title), label: "Keyword en el H1", fix: "" },
    { id: "slug", w: 5, ok: kwIn(kw, (p.slug ?? "").replace(/-/g, " ")), label: "Keyword en el slug", fix: "" },
    { id: "first100", w: 8, ok: kwIn(kw, first100), label: "Keyword en las primeras 100 palabras", fix: `Introduce la keyword «${kw}» de forma natural en la introducción (primeras 100 palabras).` },
    { id: "h2kw", w: 6, ok: h2Kw, label: "Keyword en al menos un H2", fix: `Incluye la keyword «${kw}» (o variante muy cercana) en al menos un H2.` },
    {
      id: "density", w: 6, ok: density >= 0.3 && density <= 2.0,
      label: `Densidad de keyword 0,3–2 % (${density} %, ${occ} apariciones)`,
      fix: density < 0.3 ? `Aumenta ligeramente las menciones de «${kw}» (objetivo 0,5–1,2 %), sin forzar.` : `Reduce las repeticiones de «${kw}» usando sinónimos; hay sobreoptimización.`
    },
    { id: "length", w: 10, ok: words >= min * 0.9, label: `Extensión ≥ ${min} palabras (${words})`, fix: `Amplía el artículo hasta al menos ${min} palabras aportando profundidad real (ejemplos, pasos, matices), no relleno.` },
    { id: "h2count", w: 4, ok: h2.length >= 4, label: `Estructura ≥ 4 H2 (${h2.length})`, fix: "Divide el contenido en al menos 4 secciones H2 claras." },
    { id: "noh1", w: 3, ok: !/<h1/i.test(html), label: "Sin H1 duplicado en el cuerpo", fix: "Elimina cualquier <h1> del cuerpo (el H1 lo pone el título)." },
    { id: "internal", w: 8, ok: internal >= 3, label: `Enlaces internos ≥ 3 (${internal})`, fix: "Añade enlaces internos a las URLs del cliente indicadas en el brief." },
    { id: "external", w: 4, ok: external >= 1 || !asArray(brief.external_links).length, label: `Enlace externo de autoridad (${external})`, fix: "Incluye el enlace externo de autoridad del brief." },
    { id: "faq", w: 6, ok: faq.length >= 3, label: `Bloque FAQ ≥ 3 preguntas (${faq.length})`, fix: "Añade la sección <h2>Preguntas frecuentes</h2> con al menos 4 preguntas en <h3> y respuestas de 40–80 palabras." },
    { id: "snippet", w: 4, ok: snippetWords >= 25 && snippetWords <= 90, label: `Párrafo snippet tras el primer H2 (${snippetWords} palabras)`, fix: "El primer párrafo tras el primer H2 debe responder directamente la búsqueda en 40–60 palabras." },
    { id: "paragraphs", w: 4, ok: longP === 0, label: `Párrafos legibles (≤110 palabras; ${longP} largos)`, fix: "Divide los párrafos de más de 110 palabras." },
    { id: "sentences", w: 4, ok: avgSentence > 0 && avgSentence <= 24, label: `Longitud media de frase ≤ 24 palabras (${avgSentence})`, fix: "Acorta frases largas; alterna frases cortas y largas." },
    {
      id: "ai_tells", w: 8, ok: foundTells.length === 0 && emdash <= 3,
      label: "Sin muletillas de IA" + (foundTells.length ? ` (${foundTells.join(", ")})` : "") + (emdash > 3 ? ` · ${emdash} rayas` : ""),
      fix: `Reescribe estas expresiones típicas de IA: ${foundTells.join(", ")}` + (emdash > 3 ? ". Sustituye la mayoría de rayas (—) por comas, puntos o paréntesis." : "")
    },
    { id: "alt", w: 3, ok: altKw, label: "Keyword en algún alt de imagen", fix: "" }
  ];

  let total = 0;
  let got = 0;
  const issues: string[] = [];
  for (const c of checks) {
    total += c.w;
    if (c.ok) got += c.w;
    else if (c.fix) issues.push(c.fix);
  }
  return {
    score: Math.round((got / total) * 100),
    checks,
    issues,
    stats: {
      words, density, occurrences: occ, h2: h2.length, h3: h3.length, internal, external,
      faq: faq.length, avgSentence, readingMinutes: Math.max(1, Math.round(words / 220))
    }
  };
}

/** Añade ids a los H2 y construye un índice tras la introducción. */
export function addToc(html: string, lang: string): string {
  const items: { id: string; label: string }[] = [];
  const used = new Set<string>();
  const out = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (_m, attrs: string, inner: string) => {
    const label = plainText(inner);
    let id = slugify(label) || "seccion";
    const base = id;
    let i = 2;
    while (used.has(id)) id = `${base}-${i++}`;
    used.add(id);
    items.push({ id, label });
    const clean = attrs.replace(/\sid=["'][^"']*["']/i, "");
    return `<h2 id="${id}"${clean}>${inner}</h2>`;
  });
  if (items.length < 3) return out;
  const title = lang.startsWith("es") ? "Índice de contenidos" : lang.startsWith("de") ? "Inhaltsverzeichnis" : "Contents";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const toc =
    `<nav class="nvp-toc" aria-label="${esc(title)}"><details open><summary><strong>${esc(title)}</strong></summary><ol>` +
    items.map((it) => `<li><a href="#${it.id}">${esc(it.label)}</a></li>`).join("") +
    "</ol></details></nav>";
  const pos = out.search(/<h2/i);
  return pos < 0 ? out : out.slice(0, pos) + toc + "\n" + out.slice(pos);
}

/** JSON-LD BlogPosting + FAQPage. %%permalink%% / %%date_*%% los sustituye el plugin puente. */
export function buildSchema(
  p: { title: string; metaDescription: string; keyword: string; secondaryKeywords: unknown; content: string | null },
  site: { siteUrl: string; language: string; location: string; clientName: string },
  featuredUrl: string,
  faq: { q: string; a: string }[]
) {
  const org = { "@type": "Organization", name: site.clientName, url: site.siteUrl.replace(/\/+$/, "") + "/" };
  const article: any = {
    "@type": "BlogPosting",
    "@id": "%%permalink%%#article",
    headline: p.title.slice(0, 110),
    description: p.metaDescription,
    inLanguage: site.language,
    mainEntityOfPage: "%%permalink%%",
    datePublished: "%%date_published%%",
    dateModified: "%%date_modified%%",
    author: org,
    publisher: org,
    keywords: [p.keyword, ...asArray<string>(p.secondaryKeywords)].join(", "),
    wordCount: wordCount(p.content ?? "")
  };
  if (featuredUrl) article.image = { "@type": "ImageObject", url: featuredUrl };
  if (site.location) article.contentLocation = { "@type": "Place", name: site.location };
  const graph: any[] = [article];
  if (faq.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": "%%permalink%%#faq",
      mainEntity: faq.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } }))
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

/** Limpia la salida HTML de la IA. */
export function cleanHtml(html: string): string {
  return String(html ?? "")
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, "")
    .replace(/<\/?(html|body|head|article|main)[^>]*>/gi, "")
    .replace(/\sstyle="[^"]*"/gi, "")
    .trim();
}

export { decodeEntities };
