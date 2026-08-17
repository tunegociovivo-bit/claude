import { describe, expect, it } from "vitest";
import { buildFairOutreach, discoverExhibitorUrls, normalizeFairInput } from "../trade-fair-exhibitors";

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
