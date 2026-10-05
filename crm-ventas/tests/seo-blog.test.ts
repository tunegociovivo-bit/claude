import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { addToc, analyze, buildSchema, cleanHtml, extractFaq, kwIn, kwOccurrences } from "../lib/seo-blog/seo";
import { extractJson, madridToUtc, slugify, utcToMadrid, wordCount } from "../lib/seo-blog/util";
import { assembleHtml, looksLikeKeywordColon } from "../lib/seo-blog/pipeline";
import { normalizeSiteUrl } from "../lib/seo-blog/wp";
import { sanitizePreviewHtml, safeUrl } from "../lib/seo-blog/html-sanitize";
import { replaceFaqSection } from "../lib/seo-blog/faq";
import { encodePairCode, hashPairToken, newPairToken } from "../lib/seo-blog/pair";
import { NV_SEO_BRIDGE_PHP, NV_SEO_BRIDGE_VERSION } from "../lib/seo-blog/bridge-plugin";
import { seoBlogSettingsFrom } from "../lib/seo-blog/settings";
import { resolvePublicTarget } from "../lib/seo-blog/net";

const para = (n: number) => "<p>" + Array.from({ length: n }, (_, i) => `palabra${i % 7}`).join(" ") + ".</p>";

const ARTICLE =
  "<p>El injerto capilar en Marbella es una decisión importante. Aquí tienes lo esencial.</p>" +
  "<h2>¿Qué es el injerto capilar en Marbella?</h2><p>" + "Respuesta directa y breve para el fragmento destacado. ".repeat(6) + "</p>" +
  '<!--NVP_IMG_1--><p>Más detalle con <a href="https://cliente.es/contacto/">contacto</a>, <a href="https://cliente.es/precios/">precios</a> y <a href="https://cliente.es/fue/">técnica FUE</a>. Ver <a href="https://www.sanidad.gob.es/x">Sanidad</a>.</p>' +
  "<h2>Precio</h2>" + para(60) + "<h2>Recuperación</h2>" + para(60) + "<h2>Cómo elegir clínica</h2>" + para(60) +
  "<h2>Preguntas frecuentes</h2><h3>¿Duele?</h3><p>Se usa anestesia local y la mayoría lo tolera bien.</p>" +
  "<h3>¿Cuánto cuesta?</h3><p>Depende del número de unidades foliculares.</p><h3>¿Es definitivo?</h3><p>Sí, el pelo trasplantado es resistente.</p>";

describe("keyword matching (Hub)", () => {
  test("matches literal and with interleaved words / accents", () => {
    assert.equal(kwIn("injerto capilar marbella", "Injerto capilar en Marbella: guía"), true);
    assert.equal(kwIn("clínica capilar", "CLINICA CAPILAR"), true);
    assert.equal(kwIn("injerto capilar marbella", "trasplante en Madrid"), false);
    assert.equal(kwOccurrences("injerto capilar marbella", "El injerto capilar en Marbella y el injerto capilar marbella"), 2);
  });
});

describe("analyze (Hub)", () => {
  test("scores a well-formed article and reports stats", () => {
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
    assert.equal(r.stats.internal, 3);
    assert.equal(r.stats.external, 1);
    assert.equal(r.stats.faq, 3);
    assert.equal(r.checks.find((c) => c.id === "kw_title")!.ok, true);
    assert.equal(r.checks.find((c) => c.id === "ai_tells")!.ok, true);
    assert.ok(r.score >= 80);
  });

  test("flags AI clichés", () => {
    const r = analyze(
      { content: "<p>Sin lugar a dudas, en el mundo actual todo cambia.</p>", keyword: "x", title: "x", slug: "x", metaTitle: "", metaDescription: "", brief: {} },
      { siteUrl: "https://a.es", language: "es-ES", wordsMin: 1000 }
    );
    const tells = r.checks.find((c) => c.id === "ai_tells")!;
    assert.equal(tells.ok, false);
    assert.ok(tells.label.includes("sin lugar a dudas"));
  });
});

describe("assembly helpers (Hub)", () => {
  test("extracts FAQ", () => {
    assert.deepEqual(extractFaq(ARTICLE).map((x) => x.q), ["¿Duele?", "¿Cuánto cuesta?", "¿Es definitivo?"]);
  });

  test("adds a TOC with unique anchors before the first H2", () => {
    const html = addToc(ARTICLE, "es-ES");
    assert.ok(html.includes('<nav class="nvp-toc"'));
    assert.ok(html.indexOf("nvp-toc") < html.indexOf("<h2"));
    assert.ok(html.includes('id="que-es-el-injerto-capilar-en-marbella"'));
  });

  test("inserts figures at markers and drops failed images", () => {
    const html = assembleHtml(
      ARTICLE,
      [
        { role: "featured", after_h2: 0, subject: "", alt: "a", title: "t", caption: "", status: "done" },
        { role: "inline", after_h2: 0, subject: "", alt: "Alt <1>", title: "t", caption: "Leyenda", status: "done", width: 1024, height: 576 }
      ],
      "es-ES",
      (_img, i) => `https://cdn.test/${i}.webp`
    );
    assert.ok(html.includes('src="https://cdn.test/1.webp"'));
    assert.ok(html.includes('alt="Alt &lt;1>"'));
    assert.ok(!html.includes("NVP_IMG"));
  });

  test("builds BlogPosting + FAQPage schema", () => {
    const s = buildSchema(
      { title: "T", metaDescription: "D", keyword: "k", secondaryKeywords: ["a"], content: ARTICLE },
      { siteUrl: "https://c.es/", language: "es-ES", location: "Marbella", clientName: "C" },
      "https://img",
      extractFaq(ARTICLE)
    );
    assert.deepEqual(s["@graph"].map((n: any) => n["@type"]), ["BlogPosting", "FAQPage"]);
  });

  test("cleans model HTML", () => {
    assert.equal(cleanHtml('```html\n<h1>X</h1><p style="a">Hola</p>\n```'), "<p>Hola</p>");
  });
});

describe("util (Hub)", () => {
  test("slugifies like WordPress", () => {
    assert.equal(slugify("Injerto Capilar en Marbella: ¿Cuánto cuesta? 2026"), "injerto-capilar-en-marbella-cuanto-cuesta-2026");
  });
  test("parses messy JSON", () => {
    assert.deepEqual(extractJson('Aquí va: {"a":[1,2],"b":"}"} fin'), { a: [1, 2], b: "}" });
  });
  test("converts Madrid local time ↔ UTC across DST", () => {
    assert.equal(madridToUtc("2026-07-10 09:00")!.toISOString(), "2026-07-10T07:00:00.000Z");
    assert.equal(madridToUtc("2026-12-10")!.toISOString(), "2026-12-10T08:00:00.000Z");
    assert.equal(utcToMadrid(new Date("2026-12-10T08:00:00Z")), "2026-12-10 09:00");
  });
  test("counts words ignoring tags", () => {
    assert.equal(wordCount("<p>uno <b>dos</b></p><p>tres</p>"), 3);
  });
});

describe("looksLikeKeywordColon (Hub)", () => {
  test("detecta el patrón «Keyword: resto»", () => {
    assert.equal(looksLikeKeywordColon("Blefaroplastia: cuánto dura la recuperación semana a semana", "blefaroplastia"), true);
    assert.equal(looksLikeKeywordColon("Aumento de pecho Marbella: implantes sobre o bajo el músculo", "aumento de pecho marbella"), true);
    assert.equal(looksLikeKeywordColon("Aumento de pecho en Marbella | guía", "aumento de pecho marbella"), true);
  });
  test("acepta títulos con la keyword integrada", () => {
    assert.equal(looksLikeKeywordColon("Cuánto dura la recuperación de una blefaroplastia semana a semana", "blefaroplastia"), false);
    assert.equal(looksLikeKeywordColon("Implantes sobre o bajo el músculo en un aumento de pecho en Marbella", "aumento de pecho marbella"), false);
    assert.equal(looksLikeKeywordColon("Qué esperar tras una blefaroplastia: guía por semanas", "blefaroplastia"), false);
  });
});

describe("normalizeSiteUrl (Hub)", () => {
  test("añade https y quita barras finales", () => {
    assert.equal(normalizeSiteUrl("clinicamarch.com/"), "https://clinicamarch.com");
    assert.equal(normalizeSiteUrl("  https://www.cliente.com///  "), "https://www.cliente.com");
  });
  test("quita rutas de administración y login", () => {
    assert.equal(normalizeSiteUrl("https://clinicamarch.com/wp-admin/"), "https://clinicamarch.com");
    assert.equal(normalizeSiteUrl("https://clinicamarch.com/wp-login.php?redirect_to=x"), "https://clinicamarch.com");
    assert.equal(normalizeSiteUrl("https://clinicamarch.com/wp-json/wp/v2"), "https://clinicamarch.com");
  });
  test("conserva subdirectorios reales del WordPress", () => {
    assert.equal(normalizeSiteUrl("https://cliente.com/blog/"), "https://cliente.com/blog");
    assert.equal(normalizeSiteUrl("https://cliente.com/blog/wp-admin"), "https://cliente.com/blog");
  });
  test("vacío → vacío", () => {
    assert.equal(normalizeSiteUrl(""), "");
  });
});

describe("sanitizePreviewHtml (CRM)", () => {
  test("elimina scripts, iframes, manejadores y URLs javascript:", () => {
    const out = sanitizePreviewHtml(
      '<p onclick="x()">Hola</p><script>alert(1)</script><iframe src="https://x"></iframe>' +
        '<a href=javascript:alert(1)>a</a><a href=" jav&#x61;script:alert(1)">b</a><img src="x" onerror="alert(1)"><svg><script>1</script></svg>'
    );
    assert.ok(!/script|iframe|onclick|onerror|javascript|<svg/i.test(out), out);
    assert.ok(out.includes("<p>Hola</p>"));
  });
  test("conserva el HTML del artículo (índice, figuras, tablas, enlaces)", () => {
    const html = assembleHtml(ARTICLE, [
      { role: "featured", after_h2: 0, subject: "", alt: "a", title: "t", caption: "", status: "done" },
      { role: "inline", after_h2: 0, subject: "", alt: "Alt", title: "t", caption: "Leyenda", status: "done", width: 10, height: 10 }
    ], "es-ES", (_i, n) => `https://cdn.test/${n}.webp`);
    const out = sanitizePreviewHtml(html + '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><a href="https://x.es" target="_blank" rel="noopener">x</a>');
    assert.ok(out.includes('<nav class="nvp-toc"'));
    assert.ok(out.includes('<img src="https://cdn.test/1.webp"'));
    assert.ok(out.includes("<figcaption>Leyenda</figcaption>"));
    assert.ok(out.includes("<thead>"));
    assert.ok(out.includes('target="_blank" rel="noopener noreferrer"'));
    assert.ok(out.includes('href="#que-es-el-injerto-capilar-en-marbella"'));
  });
  test("safeUrl", () => {
    assert.equal(safeUrl("https://a.es/x"), "https://a.es/x");
    assert.equal(safeUrl("#ancla"), "#ancla");
    assert.equal(safeUrl("java\nscript:alert(1)"), null);
    assert.equal(safeUrl("data:text/html,<b>"), null);
  });
});

describe("replaceFaqSection (CRM)", () => {
  test("reescribe la sección FAQ y el schema sale de ella", () => {
    const out = replaceFaqSection(ARTICLE + "<h2>Siguiente paso</h2><p>Llámanos.</p>", [{ q: "¿Nueva?", a: "Sí <b>nueva</b>." }]);
    assert.deepEqual(extractFaq(out), [{ q: "¿Nueva?", a: "Sí <b>nueva</b>." }]);
    assert.ok(out.includes("<h2>Siguiente paso</h2><p>Llámanos.</p>"));
    assert.ok(out.includes("&lt;b&gt;"));
  });
  test("crea la sección si no existe y la quita si queda vacía", () => {
    const created = replaceFaqSection("<p>Hola</p>", [{ q: "¿A?", a: "B" }]);
    assert.equal(extractFaq(created).length, 1);
    const removed = replaceFaqSection(ARTICLE, []);
    assert.equal(extractFaq(removed).length, 0);
    assert.ok(!/Preguntas frecuentes/.test(removed));
  });
});

describe("emparejamiento y plugin (CRM)", () => {
  test("código NVP1 con la URL del CRM, hash estable y tokens aleatorios", () => {
    const code = encodePairCode("https://crm.negociovivo.app", "site123", "tok");
    assert.ok(code.startsWith("NVP1."));
    assert.equal(Buffer.from(code.slice(5), "base64url").toString(), "https://crm.negociovivo.app|site123|tok");
    assert.equal(hashPairToken("abc"), hashPairToken("abc"));
    assert.notEqual(newPairToken(), newPairToken());
  });
  test("plugin 2.1.0 con textos de Negocio Vivo y contraseña propia del CRM", () => {
    assert.equal(NV_SEO_BRIDGE_VERSION, "2.1.0");
    assert.ok(NV_SEO_BRIDGE_PHP.includes("Version: 2.1.0"));
    assert.ok(!NV_SEO_BRIDGE_PHP.includes("'2.0.0'"));
    assert.ok(!/Hub Negocio Vivo'/.test(NV_SEO_BRIDGE_PHP), "no debe borrar ni crear la contraseña del Hub");
    assert.equal((NV_SEO_BRIDGE_PHP.match(/'Negocio Vivo CRM'/g) ?? []).length, 2);
    assert.ok(!/el Hub/i.test(NV_SEO_BRIDGE_PHP));
  });
});

describe("ajustes (CRM)", () => {
  test("solo preferencias del negocio, con límites; claves del entorno", () => {
    const s = seoBlogSettingsFrom({ seoBlog: { seoMinScore: 10, ideasPerRun: 99, notifyEmail: "no-es-email", modelWriter: "otro", serperApiKey: "x" } });
    assert.equal(s.seoMinScore, 50);
    assert.equal(s.ideasPerRun, 30);
    assert.equal(s.notifyEmail, "");
    assert.notEqual(s.modelWriter, "otro");
    assert.equal(s.serperApiKey, process.env.SERPER_API_KEY || null);
  });
});

describe("anti-SSRF (CRM)", () => {
  test("rechaza direcciones privadas y protocolos no web", async () => {
    for (const u of ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5", "http://[::1]/", "http://169.254.169.254/latest", "ftp://a.es", "http://u:p@a.es", "http://intranet.local/"]) {
      await assert.rejects(resolvePublicTarget(u), Error, u);
    }
  });
  test("acepta IPs públicas", async () => {
    const t = await resolvePublicTarget("https://93.184.215.14/");
    assert.equal(t.address, "93.184.215.14");
  });
});
