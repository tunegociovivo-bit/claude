/**
 * Slice E0 — reconciliación pura: emparejado por plantilla+periodo+importe,
 * veredicto de readiness, join legacy:X, periodo YYYY-MM.
 */
import { describe, it, expect } from "vitest";
import { reconcile, legacyKeyOf, periodOf, type HubPreview, type LegacyInvoice } from "../reconcile";

const hub = (ext: string | null, period: string, cents: number): HubPreview => ({ externalId: ext, period, totalCents: cents });
const leg = (id: string, period: string, cents: number): LegacyInvoice => ({ legacyTemplateId: id, period, totalCents: cents });

describe("legacyKeyOf / periodOf", () => {
  it("extrae la clave legada; null si no es legacy:", () => {
    expect(legacyKeyOf("legacy:INV123")).toBe("INV123");
    expect(legacyKeyOf("auto-abc")).toBeNull();
    expect(legacyKeyOf(null)).toBeNull();
  });
  it("periodo YYYY-MM en UTC", () => {
    expect(periodOf(new Date("2026-03-15T00:00:00Z"))).toBe("2026-03");
    expect(periodOf("2026-12-01T00:00:00Z")).toBe("2026-12");
  });
});

describe("reconcile", () => {
  it("match perfecto → ready", () => {
    const r = reconcile([hub("legacy:A", "2026-01", 12100), hub("legacy:A", "2026-02", 12100)], [leg("A", "2026-01", 12100), leg("A", "2026-02", 12100)]);
    expect(r.match).toBe(2);
    expect(r.amountMismatch).toBe(0);
    expect(r.onlyLegacy).toBe(0);
    expect(r.readiness).toBe("ready");
    expect(r.matchRate).toBe(1);
  });
  it("diferencia de importe → not_ready", () => {
    const r = reconcile([hub("legacy:A", "2026-01", 10000)], [leg("A", "2026-01", 12100)]);
    expect(r.amountMismatch).toBe(1);
    expect(r.readiness).toBe("not_ready");
    expect(r.cells[0].status).toBe("amount_mismatch");
    expect(r.cells[0].hubCents).toBe(10000);
    expect(r.cells[0].legacyCents).toBe(12100);
  });
  it("hueco: el legado emitió pero el Hub no lo previó → only_legacy, review", () => {
    const r = reconcile([], [leg("A", "2026-01", 12100)]);
    expect(r.onlyLegacy).toBe(1);
    expect(r.readiness).toBe("review");
  });
  it("only_hub (preview sin factura legada) es informativo, no bloquea", () => {
    const r = reconcile([hub("legacy:A", "2026-05", 12100)], []);
    expect(r.onlyHub).toBe(1);
    expect(r.readiness).toBe("ready"); // sin mismatches ni huecos
  });
  it("previews sin contraparte posible (CSV/HUB) se excluyen de la rejilla", () => {
    const r = reconcile([hub("auto-x", "2026-01", 5000), hub(null, "2026-01", 5000)], []);
    expect(r.totalCells).toBe(0);
  });
  it("agrega importes del mismo (plantilla, periodo)", () => {
    const r = reconcile([hub("legacy:A", "2026-01", 5000), hub("legacy:A", "2026-01", 5000)], [leg("A", "2026-01", 10000)]);
    expect(r.match).toBe(1); // 5000+5000 == 10000
  });
});
