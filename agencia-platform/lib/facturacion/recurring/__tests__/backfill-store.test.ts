/**
 * Slice B — persistencia backfill: preview (dry-run, no escribe), commit
 * idempotente, rollback SOLO de LEGACY_INVOICE, tenant en toda consulta,
 * concurrencia (P2002).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { previewBackfill, commitBackfill, rollbackBackfill } from "../backfill-store";

const legacyRow = (id: string, extra: any = {}) => ({
  id,
  workspaceId: "w1",
  type: "NORMAL",
  series: "FAC",
  issuerId: "iss1",
  clientId: "cli1",
  issuerSnapshot: { name: "E" },
  clientSnapshot: { name: "Acme", taxId: "B1" },
  currency: "EUR",
  paymentMethod: "TRANSFER",
  lines: [{ description: "Cuota", quantity: 1, unitPriceCents: 10000, taxRate: 21 }],
  subtotalCents: 10000,
  taxCents: 2100,
  totalCents: 12100,
  issueDate: new Date("2026-01-01Z"),
  recurrenceConfig: { intervalMonths: 1, nextRunAt: "2026-09-01Z" },
  ...extra
});

function mkPrisma() {
  return {
    invoice: { findMany: vi.fn() },
    recurringInvoiceTemplate: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() }
  };
}
let prisma: ReturnType<typeof mkPrisma>;
beforeEach(() => {
  prisma = mkPrisma();
});

describe("previewBackfill — dry-run, no escribe", () => {
  it("clasifica create/unchanged/update/conflict; NO escribe", async () => {
    prisma.invoice.findMany.mockResolvedValue([
      legacyRow("a"), // nuevo → create
      legacyRow("b"), // ya existe, mismo checksum → unchanged
      legacyRow("c"), // ya existe, distinto checksum → update
      legacyRow("d", { lines: [] }) // sin líneas → conflict
    ]);
    // checksum de b: lo calculamos indirectamente marcando su externalId con el mismo checksum
    const { mapLegacy } = await import("../backfill");
    const bSum = mapLegacy(legacyRow("b")).data!.checksum;
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([
      { externalId: "legacy:b", checksum: bSum },
      { externalId: "legacy:c", checksum: "viejo" }
    ]);
    const r = await previewBackfill(prisma as any, "w1");
    expect(r.total).toBe(4);
    expect(r.toCreate).toBe(1);
    expect(r.unchanged).toBe(1);
    expect(r.toUpdate).toBe(1);
    expect(r.conflicts).toBe(1);
    // tenant + dry-run
    expect(prisma.invoice.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
    expect(prisma.recurringInvoiceTemplate.create).not.toHaveBeenCalled();
    expect(prisma.recurringInvoiceTemplate.updateMany).not.toHaveBeenCalled();
  });
  it("solo lee plantillas legadas (recurring:true, no canceladas)", async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([]);
    await previewBackfill(prisma as any, "w1");
    const w = prisma.invoice.findMany.mock.calls[0][0].where;
    expect(w).toMatchObject({ workspaceId: "w1", recurring: true, deletedAt: null });
    expect(w.status).toMatchObject({ not: "CANCELLED" });
  });
});

describe("commitBackfill — idempotente, solo draft, tenant", () => {
  it("crea nuevas; salta conflictos; workspaceId en el create", async () => {
    prisma.invoice.findMany.mockResolvedValue([legacyRow("a"), legacyRow("bad", { clientId: null, clientSnapshot: null })]);
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue(null);
    prisma.recurringInvoiceTemplate.create.mockResolvedValue({});
    const r = await commitBackfill(prisma as any, "w1", "u1");
    expect(r.created).toBe(1);
    expect(r.conflicts).toBe(1);
    const data = prisma.recurringInvoiceTemplate.create.mock.calls[0][0].data;
    expect(data.workspaceId).toBe("w1");
    expect(data.status).toBe("draft");
    expect(data.source).toBe("LEGACY_INVOICE");
  });
  it("mismo checksum + mismo schedule → unchanged y NO reescribe", async () => {
    const { mapLegacy } = await import("../backfill");
    prisma.invoice.findMany.mockResolvedValue([legacyRow("a")]);
    const m = mapLegacy(legacyRow("a")).data!;
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue({ id: "e1", checksum: m.checksum, nextIssueAt: m.nextIssueAt });
    const r = await commitBackfill(prisma as any, "w1", "u1");
    expect(r.unchanged).toBe(1);
    expect(prisma.recurringInvoiceTemplate.create).not.toHaveBeenCalled();
    expect(prisma.recurringInvoiceTemplate.updateMany).not.toHaveBeenCalled(); // schedule no cambió
  });
  it("mismo checksum PERO schedule avanzó → re-sincroniza nextIssueAt (unchanged de contenido)", async () => {
    const { mapLegacy } = await import("../backfill");
    prisma.invoice.findMany.mockResolvedValue([legacyRow("a")]);
    const m = mapLegacy(legacyRow("a")).data!;
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue({ id: "e1", checksum: m.checksum, nextIssueAt: new Date("2020-01-01Z") });
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 1 });
    const r = await commitBackfill(prisma as any, "w1", "u1");
    expect(r.unchanged).toBe(1);
    expect(prisma.recurringInvoiceTemplate.updateMany).toHaveBeenCalled();
    const data = prisma.recurringInvoiceTemplate.updateMany.mock.calls[0][0].data;
    expect(data.nextIssueAt).toBeTruthy();
    expect(data.nextIssueAt).not.toHaveProperty("checksum"); // solo campos de schedule
  });
  it("P2002 concurrente → unchanged (no rompe)", async () => {
    prisma.invoice.findMany.mockResolvedValue([legacyRow("a")]);
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue(null);
    prisma.recurringInvoiceTemplate.create.mockRejectedValue({ code: "P2002" });
    const r = await commitBackfill(prisma as any, "w1", "u1");
    expect(r.unchanged).toBe(1);
    expect(r.errors).toHaveLength(0);
  });
});

describe("rollbackBackfill — borra SOLO backfilled, tenant", () => {
  it("deleteMany scoped por workspace + source LEGACY_INVOICE", async () => {
    prisma.recurringInvoiceTemplate.deleteMany.mockResolvedValue({ count: 3 });
    const r = await rollbackBackfill(prisma as any, "w1");
    expect(r.deleted).toBe(3);
    expect(prisma.recurringInvoiceTemplate.deleteMany.mock.calls[0][0].where).toEqual({ workspaceId: "w1", source: "LEGACY_INVOICE" });
  });
});
