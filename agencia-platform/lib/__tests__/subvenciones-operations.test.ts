import { describe, expect, it } from "vitest";
import { hasDeliveryChannel, isLowValueBusinessOpportunity } from "../subvenciones/operations";
import { parsePlacspAtom } from "../subvenciones/placsp";

describe("cazador de subvenciones", () => {
  it("permite WhatsApp aunque no exista webhook de Make", () => {
    expect(hasDeliveryChannel("", "34600000000")).toBe(true);
  });

  it("permite webhook aunque no exista WhatsApp", () => {
    expect(hasDeliveryChannel("https://hook.example.test", "")).toBe(true);
  });

  it("descarta nominativas sin señal empresarial", () => {
    expect(isLowValueBusinessOpportunity({ titulo: "Subvención nominativa a una asociación cultural" })).toBe(true);
  });

  it("conserva convocatorias destinadas a pymes", () => {
    expect(isLowValueBusinessOpportunity({ titulo: "Ayudas para pymes y autónomos" })).toBe(false);
  });

  it("extrae únicamente licitaciones PLACSP relevantes y abiertas", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:cbc="urn:cbc"><entry><id>EXP-1</id><title>Servicio de marketing digital y SEO</title><summary>Campaña de publicidad</summary><updated>2026-08-20</updated><cbc:EndDate>2026-09-30</cbc:EndDate><cbc:EstimatedOverallContractAmount>125000.50</cbc:EstimatedOverallContractAmount><link href="https://example.test/exp-1" /></entry><entry><id>EXP-2</id><title>Suministro de mobiliario</title><summary>Mesas de oficina</summary></entry></feed>`;
    const rows = parsePlacspAtom(xml, new Date("2026-08-25T00:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ titulo: "Servicio de marketing digital y SEO", importeTotal: 125000.5, fechaFin: new Date("2026-09-30") });
  });

  it("descarta licitaciones PLACSP vencidas", () => {
    const xml = `<feed><entry><id>EXP-OLD</id><title>Servicio de publicidad</title><EndDate>2026-01-01</EndDate></entry></feed>`;
    expect(parsePlacspAtom(xml, new Date("2026-08-25T00:00:00Z"))).toHaveLength(0);
  });
});
