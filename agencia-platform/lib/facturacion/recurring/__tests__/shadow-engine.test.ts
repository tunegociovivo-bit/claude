/**
 * Slice C — motor shadow: persiste previews idempotentes (anti doble-factura),
 * nunca toca Invoice, tenant, concurrencia (P2002), respeta estados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runShadow, listPreviews } from "../shadow-engine";

const tpl = (o: any = {}) => ({
  id: "t1",
  workspaceId: "w1",
  status: "active",
  currency: "EUR",
  paymentMethod: "TRANSFER",
  series: "FAC",
  lines: [{ description: "Cuota", quantity: 1, unitPriceCents: 10000, taxRate: 21 }],
  subtotalCents: 10000,
  taxCents: 2100,
  totalCents: 12100,
  issuerSnapshot: { name: "E" },
  clientSnapshot: { name: "Acme" },
  intervalMonths: 1,
  dayOfMonth: 1,
  anchorDate: new Date("2026-01-01Z"),
  startDate: new Date("2026-01-01Z"),
  endDate: null,
  nextIssueAt: new Date("2026-03-01Z"),
  ...o
});

function mkPrisma() {
  return { recurringInvoiceTemplate: { findMany: vi.fn() }, recurringInvoicePreview: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() } };
}
let prisma: ReturnType<typeof mkPrisma>;
beforeEach(() => {
  prisma = mkPrisma();
});

describe("runShadow", () => {
  it("crea previews para las ocurrencias debidas; nunca toca Invoice", async () => {
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([tpl()]);
    prisma.recurringInvoicePreview.findFirst.mockResolvedValue(null);
    prisma.recurringInvoicePreview.create.mockResolvedValue({});
    const r = await runShadow(prisma as any, "w1", new Date("2026-05-15Z"));
    // marzo, abril, mayo → 3 previews
    expect(r.previewsCreated).toBe(3);
    expect(r.previewsSkipped).toBe(0);
    const data = prisma.recurringInvoicePreview.create.mock.calls[0][0].data;
    expect(data.workspaceId).toBe("w1");
    expect(data.status).toBe("preview");
    expect(data.totalCents).toBe(12100);
    expect((prisma as any).invoice).toBeUndefined(); // no existe camino a Invoice
    // tenant en la carga de plantillas
    expect(prisma.recurringInvoiceTemplate.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
  });

  it("idempotente: preview existente → skip (anti doble-factura)", async () => {
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([tpl({ nextIssueAt: new Date("2026-05-01Z") })]);
    prisma.recurringInvoicePreview.findFirst.mockResolvedValue({ id: "p1" }); // ya existe
    const r = await runShadow(prisma as any, "w1", new Date("2026-05-15Z"));
    expect(r.previewsCreated).toBe(0);
    expect(r.previewsSkipped).toBe(1);
    expect(prisma.recurringInvoicePreview.create).not.toHaveBeenCalled();
  });

  it("carrera P2002 en create → skip (idempotente)", async () => {
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([tpl({ nextIssueAt: new Date("2026-05-01Z") })]);
    prisma.recurringInvoicePreview.findFirst.mockResolvedValue(null);
    prisma.recurringInvoicePreview.create.mockRejectedValue({ code: "P2002" });
    const r = await runShadow(prisma as any, "w1", new Date("2026-05-15Z"));
    expect(r.previewsSkipped).toBe(1);
    expect(r.errors).toHaveLength(0);
  });

  it("solo considera active/draft (pausadas/archivadas no)", async () => {
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([]);
    prisma.recurringInvoicePreview.findFirst.mockResolvedValue(null);
    await runShadow(prisma as any, "w1", new Date("2026-05-15Z"));
    expect(prisma.recurringInvoiceTemplate.findMany.mock.calls[0][0].where.status).toEqual({ in: ["active", "draft"] });
  });

  it("plantilla sin fecha base → se ignora sin error", async () => {
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([tpl({ anchorDate: null, startDate: null, nextIssueAt: null })]);
    const r = await runShadow(prisma as any, "w1", new Date("2026-05-15Z"));
    expect(r.previewsCreated).toBe(0);
    expect(r.errors).toHaveLength(0);
  });
});

describe("listPreviews — tenant", () => {
  it("consulta scoped por workspace", async () => {
    prisma.recurringInvoicePreview.findMany.mockResolvedValue([]);
    await listPreviews(prisma as any, "w1", "t1");
    expect(prisma.recurringInvoicePreview.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "w1", templateId: "t1" });
  });
});
