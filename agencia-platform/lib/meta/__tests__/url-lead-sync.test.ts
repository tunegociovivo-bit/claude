import { describe, expect, it } from "vitest";
import { getUrlLeadSources, normalizeLeadSourceUrl } from "../url-lead-sync";

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
});
