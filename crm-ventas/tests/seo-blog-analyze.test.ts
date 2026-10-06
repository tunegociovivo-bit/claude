import test from "node:test";
import assert from "node:assert/strict";
import {
  competitorCandidates,
  ctaCandidates,
  dropConsentBlocks,
  mapLanguage,
  normalizeDomain,
  pageText,
  parsePage,
  pickPages,
  serperLocale
} from "../lib/seo-blog/business-site";

const HOME = `<!doctype html><html lang="es-ES"><head>
<title>Estores Demo - Estores a medida en Málaga</title>
<meta name="description" content="Estores y cortinas a medida en Málaga">
<meta name="theme-color" content="#09498d">
<style>.a{color:#09498D}.b{color:#09498D}.c{color:#ffffff}.d{color:#333333}</style>
<script type="application/ld+json">{"@type":"HomeAndConstructionBusiness","telephone":"+34 951 000 000","address":{"@type":"PostalAddress","addressLocality":"Málaga"}}</script>
<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Organization"}]}</script>
</head><body>
<header><nav>
<a href="/estores-enrollables/">Estores enrollables</a>
<a href="/sobre-nosotros/">Quiénes somos</a>
<a href="/contacto/">Contacto</a>
<a href="/en/contact/">Contact</a>
<a href="/blog/como-limpiar-estores/">Cómo limpiar estores</a>
<a href="/politica-de-cookies/">Cookies</a>
<a href="https://www.facebook.com/demo">Facebook</a>
<a href="/wp-content/uploads/catalogo.pdf">Catálogo PDF</a>
</nav></header>
<!-- comentario <a href="/oculto/">oculto</a> -->
<h1>Estores a medida</h1>
<p>Más de 15 años instalando estores en Málaga.</p>
<script>var x = "<p>no es texto</p>";</script>
<div id="cmplz-cookiebanner-container"><div class="cmplz-body"><p>El almacenamiento o acceso técnico es necesario</p></div><button>Aceptar</button></div>
<p>Plantilla {title}</p>
<footer><a href="/estores-enrollables/">Estores enrollables</a><a href="/contacto/">Pide presupuesto</a></footer>
</body></html>`;

test("parsePage: título, descripción, idioma, color, JSON-LD útil y texto sin scripts ni cookies", () => {
  const p = parsePage(HOME, "https://www.demo.com/");
  assert.equal(p.title, "Estores Demo - Estores a medida en Málaga");
  assert.equal(p.description, "Estores y cortinas a medida en Málaga");
  assert.equal(p.lang, "es-ES");
  assert.equal(p.themeColor, "#09498D");
  assert.deepEqual(p.colors, ["#09498D"]);
  assert.equal(p.jsonLd.length, 1);
  assert.match(p.jsonLd[0], /HomeAndConstructionBusiness/);
  assert.match(p.text, /# Estores a medida/);
  assert.match(p.text, /Más de 15 años/);
  assert.doesNotMatch(p.text, /no es texto|almacenamiento|Aceptar|oculto|\{title\}/);
});

test("pickPages: quiénes somos y secciones del menú; sin artículos, legales, archivos ni otros idiomas", () => {
  const p = parsePage(HOME, "https://www.demo.com/");
  const picked = pickPages(p.links, p.url, 6);
  assert.equal(picked[0], "https://www.demo.com/sobre-nosotros/");
  assert.ok(picked.includes("https://www.demo.com/estores-enrollables/"));
  assert.ok(picked.includes("https://www.demo.com/contacto/"));
  for (const u of picked) assert.doesNotMatch(u, /blog|cookies|\.pdf|\/en\/|facebook/);
});

test("ctaCandidates: sin duplicados ni versiones en otro idioma", () => {
  const p = parsePage(HOME, "https://www.demo.com/");
  assert.deepEqual(ctaCandidates(p.links, p.url).map((l) => l.url), ["https://www.demo.com/contacto/"]);
});

test("mapLanguage y serperLocale", () => {
  assert.equal(mapLanguage("es-ES"), "es-ES");
  assert.equal(mapLanguage("es"), "es-ES");
  assert.equal(mapLanguage("es_MX"), "es-MX");
  assert.equal(mapLanguage("en-US"), "en-US");
  assert.equal(mapLanguage("en"), "en-GB");
  assert.equal(mapLanguage("ja"), null);
  assert.deepEqual(serperLocale("es-MX"), { gl: "mx", hl: "es" });
  assert.deepEqual(serperLocale("??"), { gl: "es", hl: "es" });
});

test("competitorCandidates: fuera la propia web, redes, directorios y administraciones", () => {
  const r = (link: string, position: number) => ({ link, position, title: "t", snippet: "s" });
  const out = competitorCandidates(
    [
      r("https://www.demo.com/estores/", 1),
      r("https://www.rival-estores.es/", 2),
      r("https://www.facebook.com/x", 3),
      r("https://www.paginasamarillas.es/a", 4),
      r("https://www.malaga.gob.es/", 5),
      r("https://rival-estores.es/otra", 6),
      r("https://www.leroymerlin.es/estores", 7)
    ],
    "https://www.demo.com/"
  );
  assert.deepEqual(out.map((c) => c.host), ["rival-estores.es", "leroymerlin.es"]);
  assert.equal(out[0].hits, 2);
});

test("normalizeDomain", () => {
  assert.equal(normalizeDomain("https://www.Rival.es/x"), "rival.es");
  assert.equal(normalizeDomain("rival.es"), "rival.es");
  assert.equal(normalizeDomain("no es un dominio"), "");
});

test("dropConsentBlocks respeta el anidado y no rompe si el bloque no cierra", () => {
  assert.equal(dropConsentBlocks('<p>a</p><div class="cookie-notice"><div>x</div><div>y</div></div><p>b</p>').replace(/\s+/g, ""), "<p>a</p><p>b</p>");
  const broken = '<p>a</p><div id="cookie"><div>sin cierre';
  assert.equal(dropConsentBlocks(broken), broken);
});

test("el análisis de HTML hostil es lineal (sin bloqueos por retroceso)", () => {
  const evil = [
    "<script>".repeat(20000),
    "<!--".repeat(20000),
    '<div class="cookie">'.repeat(20000),
    "<a href='/x'>".repeat(20000),
    '<script type="application/ld+json">'.repeat(20000),
    "<meta ".repeat(40000),
    "<html ".repeat(40000),
    "<".repeat(200000),
    "<a " + "x".repeat(200000),
    '<a href="' + "x=".repeat(100000)
  ];
  for (const html of evil) {
    const t0 = Date.now();
    parsePage(html, "https://www.demo.com/");
    pageText(html);
    assert.ok(Date.now() - t0 < 1500, `tardó ${Date.now() - t0} ms`);
  }
});
