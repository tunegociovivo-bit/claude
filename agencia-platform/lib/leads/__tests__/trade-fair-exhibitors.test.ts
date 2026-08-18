import { describe, expect, it } from "vitest";
import { buildFairOutreach, discoverExhibitorUrls, normalizeFairInput } from "../trade-fair-core";
import { discoverEventUrls, extractFairFromPage, filterUpcomingFairs } from "../trade-fair-discovery";

describe("robot de expositores", () => {
  it("descubre fichas de expositores y elimina enlaces ajenos y duplicados", () => {
    const html = `
      <a href="/feria/expositores/acme">ACME</a>
      <a href="https://evento.test/feria/exhibitor/beta">Beta</a>
      <a href="/feria/expositores/acme?ref=menu">ACME repetido</a>
      <a href="https://evil.test/exhibitor/robo">Externo</a>`;
    expect(discoverExhibitorUrls(html, "https://evento.test/feria/catalogo")).toEqual([
      "https://evento.test/feria/expositores/acme",
      "https://evento.test/feria/exhibitor/beta"
    ]);
  });

  it("rechaza URLs inseguras y fechas incoherentes", () => {
    expect(() => normalizeFairInput({ name: "Feria", url: "http://localhost/catalogo", venue: "IFEMA", startsAt: "2026-09-10", endsAt: "2026-09-09" })).toThrow();
  });

  it("genera una propuesta concreta con recinto, fechas y stand", () => {
    const message = buildFairOutreach({
      exhibitor: "ACME Solar", fair: "Genera 2026", venue: "IFEMA Madrid",
      startsAt: "2026-11-24", endsAt: "2026-11-26", stand: "8C12"
    });
    expect(message).toContain("ACME Solar");
    expect(message).toContain("Genera 2026");
    expect(message).toContain("24 al 26 de noviembre");
    expect(message).toContain("stand 8C12");
    expect(message).toContain("anuncios geolocalizados");
  });
});

describe("buscador automático de ferias", () => {
  it("descubre páginas de eventos dentro del calendario del organizador", () => {
    const html = `<a href="/genera">Genera</a><a href="/evento/fruit-attraction-2026">Fruit</a><a href="/contacto">Contacto</a>`;
    expect(discoverEventUrls(html, "https://www.ifema.es/calendario", [/^\/[a-z0-9-]+$/i, /^\/evento\/[a-z0-9-]+$/i])).toEqual([
      "https://www.ifema.es/genera",
      "https://www.ifema.es/evento/fruit-attraction-2026"
    ]);
  });

  it("extrae una feria y su catálogo desde datos estructurados y enlaces", () => {
    const html = `<script type="application/ld+json">{"@type":"Event","name":"Genera 2026","startDate":"2026-11-24","endDate":"2026-11-26","location":{"name":"IFEMA Madrid"}}</script><a href="/genera/expositores">Catálogo de expositores</a>`;
    expect(extractFairFromPage(html, "https://www.ifema.es/genera", "IFEMA")).toMatchObject({ name: "Genera 2026", startsAt: "2026-11-24", endsAt: "2026-11-26", venue: "IFEMA Madrid", catalogUrl: "https://www.ifema.es/genera/expositores" });
  });

  it("elimina ferias pasadas, filtra por sector y ordena por fecha", () => {
    const fairs = [
      { name: "Feria Solar", startsAt: "2026-10-10", endsAt: "2026-10-12", venue: "Madrid", url: "https://a.test/solar", catalogUrl: null, organizer: "A" },
      { name: "Clínicas del futuro", startsAt: "2026-09-10", endsAt: "2026-09-11", venue: "Barcelona", url: "https://a.test/clinicas", catalogUrl: null, organizer: "A" },
      { name: "Solar antigua", startsAt: "2025-10-10", endsAt: "2025-10-12", venue: "Madrid", url: "https://a.test/old", catalogUrl: null, organizer: "A" }
    ];
    expect(filterUpcomingFairs(fairs, new Date("2026-08-17T00:00:00Z"), "solar").map((fair) => fair.name)).toEqual(["Feria Solar"]);
  });
});
