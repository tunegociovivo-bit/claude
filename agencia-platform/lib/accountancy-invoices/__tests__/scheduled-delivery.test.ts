import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { describeMetaFailure } from "../agents";
import { buildAccountancyReportNotes } from "../report";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("scheduled accountancy run safety", () => {
  it("never creates a run without accounts and does not burn the month", () => {
    const service = read("lib/accountancy-invoices/service.ts");
    expect(service).toContain("if (!clients.length) return null;");
    expect(service).toMatch(/const run = await createAccountancyInvoiceRun\(schedule\.workspaceId, "SCHEDULED", now\);\s+\/\/[^\n]*\n[^\n]*\n\s+if \(!run\) continue;/);
    expect(service).toContain("await closeEmptyAccountancyRuns(now);");
    expect(service).toContain("items: { none: {} }");
  });

  it("refuses to toggle accounts without an id (would disable every account)", () => {
    const route = read("app/api/accountancy-invoices/route.ts");
    expect(route).toContain('if (typeof body.id !== "string" || !body.id || typeof body.enabled !== "boolean")');
  });

  it("records automatic delivery failures where the panel shows them", () => {
    const service = read("lib/accountancy-invoices/service.ts");
    expect(service).toContain('deliveryStatus: "FAILED", error: `Envío automático:');
  });
});

describe("accountancy report notes", () => {
  it("lists only what is actually missing", () => {
    expect(buildAccountancyReportNotes([
      { clientName: "Eroski", source: "META", status: "FAILED" },
      { clientName: "NV - México", source: "GOOGLE_ADS", status: "DOWNLOADED" }
    ])).toEqual(["Falta por descargar: Eroski (Meta).", "Falta incorporar las cuentas y extractos bancarios."]);
    expect(buildAccountancyReportNotes([
      { clientName: "Eroski", source: "META", status: "DOWNLOADED" },
      { clientName: "Banco", source: "BANK", status: "DOWNLOADED" }
    ])).toEqual([]);
  });
});

describe("Meta permission failures", () => {
  it("explains a missing billing permission instead of dumping the page", () => {
    const raw = "No se detectaron facturas PDF. Meta mostró: Administrador de anuncios Necesitas permiso para ver el contenido Para obtener permiso, ponte en contacto con un administrador de tu cuenta publicitaria. (1887310988376534)";
    const message = describeMetaFailure(raw, { accountId: "1887310988376534", profileLabel: "Perfil Meta 029f78" });
    expect(message).toContain("Sin permiso en Meta");
    expect(message).toContain("«Perfil Meta 029f78»");
    expect(message).toContain("1887310988376534");
    expect(describeMetaFailure("No se detectaron facturas PDF.", { accountId: "1" })).toBe("No se detectaron facturas PDF.");
  });
});
