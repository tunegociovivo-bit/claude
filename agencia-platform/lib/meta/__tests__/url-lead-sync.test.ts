import { describe, expect, it } from "vitest";
import { getUrlLeadSources, leadClassificationBatches, normalizeLeadSourceUrl, privateSheetRanges } from "../url-lead-sync";

describe("fuentes online de leads", () => {
  it("convierte un Google Spreadsheet en una exportación XLSX conservando gid", () => {
    expect(normalizeLeadSourceUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=987"))
      .toBe("https://docs.google.com/spreadsheets/d/abc123/export?format=xlsx&gid=987");
  });

  it("convierte Google Docs en texto descargable", () => {
    expect(normalizeLeadSourceUrl("https://docs.google.com/document/d/doc123/edit"))
      .toBe("https://docs.google.com/document/d/doc123/export?format=txt");
  });

  it("filtra las fuentes por campaña sin mezclar atribuciones", () => {
    const stages = { urlLeadSources: [
      { id: "a", url: "https://docs.google.com/a", campaignId: "c1" },
      { id: "b", url: "https://docs.google.com/b", campaignId: "c2" }
    ] };
    expect(getUrlLeadSources(stages, "c1").map((source) => source.id)).toEqual(["a"]);
  });

  it("limita las hojas grandes a cabeceras y las últimas 500 filas", () => {
    expect(privateSheetRanges("Leads Eroski", 25_000, 120)).toEqual([
      "'Leads Eroski'!A1:CB20",
      "'Leads Eroski'!A24501:CB25000"
    ]);
  });

  it("lee una hoja pequeña en una sola petición", () => {
    expect(privateSheetRanges("Leads", 300, 12)).toEqual(["'Leads'!A1:L300"]);
  });
  it("limita cada respuesta estructurada de IA para evitar truncamientos", () => {
    const rows = Array.from({ length: 25 }, (_, index) => index);
    expect(leadClassificationBatches(rows).map((batch) => batch.length)).toEqual([12, 12, 1]);
  });
});
