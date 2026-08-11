/**
 * Slice B — mapeo puro legado → RecurringInvoiceTemplate: campos, periodos,
 * conflictos (sin líneas/cliente, interval/día inválidos, fin<inicio), checksum,
 * status draft, externalId estable.
 */
import { describe, it, expect } from "vitest";
import { mapLegacy, backfillChecksum, type LegacyInvoiceRow } from "../backfill";

const base = (o: Partial<LegacyInvoiceRow> = {}): LegacyInvoiceRow => ({
  id: "inv1",
  workspaceId: "w1",
  type: "NORMAL",
  series: "FAC",
  issuerId: "iss1",
  clientId: "cli1",
  issuerSnapshot: { name: "Emisor SL", taxId: "B1" },
  clientSnapshot: { name: "Acme SL", taxId: "B12345678" },
  currency: "EUR",
  paymentMethod: "TRANSFER",
  lines: [{ description: "Cuota", quantity: 1, unitPriceCents: 10000, taxRate: 21, discountPct: 0 }],
  subtotalCents: 10000,
  taxCents: 2100,
  totalCents: 12100,
  issueDate: new Date("2026-01-01T00:00:00Z"),
  recurrenceConfig: { intervalMonths: 1, dayOfMonth: 1, nextRunAt: "2026-09-01T00:00:00Z", endsAt: null },
  ...o
});

describe("mapLegacy — mapeo correcto", () => {
  it("mapea a draft, source LEGACY_INVOICE, externalId estable", () => {
    const m = mapLegacy(base());
    expect(m.ok).toBe(true);
    expect(m.externalId).toBe("legacy:inv1");
    expect(m.data!.status).toBe("draft");
    expect(m.data!.source).toBe("LEGACY_INVOICE");
    expect(m.data!.intervalMonths).toBe(1);
    expect(m.data!.dayOfMonth).toBe(1);
    expect(m.data!.nextIssueAt?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(m.data!.totalCents).toBe(12100);
    expect(m.data!.sepa).toBe(false);
    expect(m.clientName).toBe("Acme SL");
  });
  it("REMITTANCE → sepa true; endsAt → endDate", () => {
    const m = mapLegacy(base({ paymentMethod: "REMITTANCE", recurrenceConfig: { intervalMonths: 12, endsAt: "2027-01-01T00:00:00Z" } }));
    expect(m.data!.sepa).toBe(true);
    expect(m.data!.intervalMonths).toBe(12);
    expect(m.data!.endDate?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("mapLegacy — conflictos (se reportan, no se importan)", () => {
  it("sin líneas", () => {
    const m = mapLegacy(base({ lines: [] }));
    expect(m.ok).toBe(false);
    expect(m.conflicts.some((c) => c.code === "no_lines")).toBe(true);
    expect(m.data).toBeUndefined();
  });
  it("sin cliente", () => {
    const m = mapLegacy(base({ clientId: null, clientSnapshot: null }));
    expect(m.conflicts.some((c) => c.code === "no_client")).toBe(true);
  });
  it("interval inválido y día inválido", () => {
    expect(mapLegacy(base({ recurrenceConfig: { intervalMonths: 0 } })).conflicts.some((c) => c.code === "bad_interval")).toBe(true);
    expect(mapLegacy(base({ recurrenceConfig: { intervalMonths: 99 } })).conflicts.some((c) => c.code === "bad_interval")).toBe(true);
    expect(mapLegacy(base({ recurrenceConfig: { intervalMonths: 1, dayOfMonth: 31 } })).conflicts.some((c) => c.code === "bad_day")).toBe(true);
  });
  it("fin antes de inicio", () => {
    const m = mapLegacy(base({ issueDate: new Date("2026-06-01Z"), recurrenceConfig: { intervalMonths: 1, endsAt: "2026-01-01T00:00:00Z" } }));
    expect(m.conflicts.some((c) => c.code === "end_before_start")).toBe(true);
  });
});

describe("checksum — estable + sensible", () => {
  it("igual contenido → igual; cambio de importe → distinto", () => {
    const a = mapLegacy(base()).data!.checksum;
    const b = mapLegacy(base()).data!.checksum;
    expect(a).toBe(b);
    const c = mapLegacy(base({ totalCents: 99999, lines: [{ description: "Cuota", quantity: 1, unitPriceCents: 82644, taxRate: 21 }] })).data!.checksum;
    expect(c).not.toBe(a);
  });
  it("cambiar método de pago cambia el checksum", () => {
    const a = mapLegacy(base()).data!.checksum;
    const b = mapLegacy(base({ paymentMethod: "REMITTANCE" })).data!.checksum;
    expect(a).not.toBe(b);
  });
});
