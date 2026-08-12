/**
 * Slice E0 — store readiness: solo lectura, tenant, mapeo de previews/legado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readinessReport } from "../reconcile-store";

function mkPrisma() {
  return { recurringInvoicePreview: { findMany: vi.fn() }, invoice: { findMany: vi.fn() } };
}
let prisma: ReturnType<typeof mkPrisma>;
beforeEach(() => {
  prisma = mkPrisma();
});

describe("readinessReport", () => {
  it("reconcilia previews Hub vs facturas legadas; tenant en ambas consultas; NO escribe", async () => {
    prisma.recurringInvoicePreview.findMany.mockResolvedValue([{ occurrenceDate: new Date("2026-01-01Z"), totalCents: 12100, template: { externalId: "legacy:A" } }]);
    prisma.invoice.findMany.mockResolvedValue([{ recurringSourceId: "A", issueDate: new Date("2026-01-15Z"), totalCents: 12100 }]);
    const r = await readinessReport(prisma as any, "w1", new Date("2026-02-01Z"));
    expect(r.match).toBe(1);
    expect(r.readiness).toBe("ready");
    expect(r.windowMonths).toBe(6);
    // tenant
    expect(prisma.recurringInvoicePreview.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
    expect(prisma.invoice.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
    // legado: solo generadas (recurringSourceId != null), no borradas
    expect(prisma.invoice.findMany.mock.calls[0][0].where.recurringSourceId).toEqual({ not: null });
    expect(prisma.invoice.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
    // read-only: no hay métodos de escritura en el mock (findMany solo)
  });
});
