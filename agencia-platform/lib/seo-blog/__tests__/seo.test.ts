import { describe, expect, it } from "vitest";
import { addToc, analyze, buildSchema, cleanHtml, extractFaq, kwIn, kwOccurrences } from "../seo";
import { extractJson, madridToUtc, slugify, utcToMadrid, wordCount } from "../util";
import { assembleHtml } from "../pipeline";

const para = (n: number) => "<p>" + Array.from({ length: n }, (_, i) => `palabra${i % 7}`).join(" ") + ".</p>";

const ARTICLE =
  "<p>El injerto capilar en Marbella es una decisión importante. Aquí tienes lo esencial.</p>" +
  '<h2>¿Qué es el injerto capilar en Marbella?</h2><p>' + "Respuesta directa y breve para el fragmento destacado. ".repeat(6) + "</p>" +
  '<!--NVP_IMG_1--><p>Más detalle con <a href="https://cliente.es/contacto/">contacto</a>, <a href="https://cliente.es/precios/">precios</a> y <a href="https://cliente.es/fue/">técnica FUE</a>. Ver <a href="https://www.sanidad.gob.es/x">Sanidad</a>.</p>' +
  "<h2>Precio</h2>" + para(60) + "<h2>Recuperación</h2>" + para(60) + "<h2>Cómo elegir clínica</h2>" + para(60) +
  "<h2>Preguntas frecuentes</h2><h3>¿Duele?</h3><p>Se usa anestesia local y la mayoría lo tolera bien.</p>" +
  "<h3>¿Cuánto cuesta?</h3><p>Depende del número de unidades foliculares.</p><h3>¿Es definitivo?</h3><p>Sí, el pelo trasplantado es resistente.</p>";

describe("keyword matching", () => {
  it("matches literal and with interleaved words / accents", () => {
    expect(kwIn("injerto capilar marbella", "Injerto capilar en Marbella: guía")).toBe(true);
    expect(kwIn("clínica capilar", "CLINICA CAPILAR")).toBe(true);
    expect(kwIn("injerto capilar marbella", "trasplante en Madrid")).toBe(false);
    expect(kwOccurrences("injerto capilar marbella", "El injerto capilar en Marbella y el injerto capilar marbella")).toBe(2);
  });
});

describe("analyze", () => {
  it("scores a well-formed article and reports stats", () => {
    const r = analyze(
      {
        content: ARTICLE,
        keyword: "injerto capilar marbella",
        title: "Injerto capilar en Marbella: guía 2026",
        slug: "injerto-capilar-marbella",
        metaTitle: "Injerto capilar en Marbella: precio y técnica FUE",
        metaDescription: "Injerto capilar en Marbella con técnica FUE: precio orientativo, recuperación y cómo elegir clínica con garantías. Pide tu valoración.",
        brief: { images: [{ alt: "Consulta de injerto capilar en Marbella" }], external_links: [{ url: "x" }] }
      },
      { siteUrl: "https://cliente.es", language: "es-ES", wordsMin: 200 }
    );
    expect(r.stats.internal).toBe(3);
    expect(r.stats.external).toBe(1);
    expect(r.stats.faq).toBe(3);
    expect(r.checks.find((c) => c.id === "kw_title")!.ok).toBe(true);
    expect(r.checks.find((c) => c.id === "ai_tells")!.ok).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it("flags AI clichés", () => {
    const r = analyze(
      { content: "<p>Sin lugar a dudas, en el mundo actual todo cambia.</p>", keyword: "x", title: "x", slug: "x", metaTitle: "", metaDescription: "", brief: {} },
      { siteUrl: "https://a.es", language: "es-ES", wordsMin: 1000 }
    );
    const tells = r.checks.find((c) => c.id === "ai_tells")!;
    expect(tells.ok).toBe(false);
    expect(tells.label).toContain("sin lugar a dudas");
  });
});

describe("assembly helpers", () => {
  it("extracts FAQ", () => {
    expect(extractFaq(ARTICLE).map((x) => x.q)).toEqual(["¿Duele?", "¿Cuánto cuesta?", "¿Es definitivo?"]);
  });

  it("adds a TOC with unique anchors before the first H2", () => {
    const html = addToc(ARTICLE, "es-ES");
    expect(html).toContain('<nav class="nvp-toc"');
    expect(html.indexOf("nvp-toc")).toBeLessThan(html.indexOf("<h2"));
    expect(html).toContain('id="que-es-el-injerto-capilar-en-marbella"');
  });

  it("inserts figures at markers and drops failed images", () => {
    const html = assembleHtml(
      ARTICLE,
      [
        { role: "featured", after_h2: 0, subject: "", alt: "a", title: "t", caption: "", status: "done" },
        { role: "inline", after_h2: 0, subject: "", alt: "Alt <1>", title: "t", caption: "Leyenda", status: "done", width: 1024, height: 576 }
      ],
      "es-ES",
      (_img, i) => `https://cdn.test/${i}.webp`
    );
    expect(html).toContain('src="https://cdn.test/1.webp"');
    expect(html).toContain('alt="Alt &lt;1>"');
    expect(html).not.toContain("NVP_IMG");
  });

  it("builds BlogPosting + FAQPage schema", () => {
    const s = buildSchema(
      { title: "T", metaDescription: "D", keyword: "k", secondaryKeywords: ["a"], content: ARTICLE },
      { siteUrl: "https://c.es/", language: "es-ES", location: "Marbella", clientName: "C" },
      "https://img",
      extractFaq(ARTICLE)
    );
    expect(s["@graph"].map((n: any) => n["@type"])).toEqual(["BlogPosting", "FAQPage"]);
  });

  it("cleans model HTML", () => {
    expect(cleanHtml("```html\n<h1>X</h1><p style=\"a\">Hola</p>\n```")).toBe("<p>Hola</p>");
  });
});

describe("util", () => {
  it("slugifies like WordPress", () => {
    expect(slugify("Injerto Capilar en Marbella: ¿Cuánto cuesta? 2026")).toBe("injerto-capilar-en-marbella-cuanto-cuesta-2026");
  });
  it("parses messy JSON", () => {
    expect(extractJson('Aquí va: {"a":[1,2],"b":"}"} fin')).toEqual({ a: [1, 2], b: "}" });
  });
  it("converts Madrid local time ↔ UTC across DST", () => {
    expect(madridToUtc("2026-07-10 09:00")!.toISOString()).toBe("2026-07-10T07:00:00.000Z");
    expect(madridToUtc("2026-12-10")!.toISOString()).toBe("2026-12-10T08:00:00.000Z");
    expect(utcToMadrid(new Date("2026-12-10T08:00:00Z"))).toBe("2026-12-10 09:00");
  });
  it("counts words ignoring tags", () => {
    expect(wordCount("<p>uno <b>dos</b></p><p>tres</p>")).toBe(3);
  });
});
