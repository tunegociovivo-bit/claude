/**
 * Slice A — persistencia: commit idempotente (checksum), tenant, siempre draft,
 * P2002 tolerado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { commitTemplates } from "../store";
import { previewCsv } from "../import";

const CSV = "externalId,clientName,description,unitPrice,taxRate\nT1,Acme,Cuota,100,21";
const tpl = () => previewCsv(CSV).items[0].template!;

function mkPrisma() {
  return { recurringInvoiceTemplate: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() } };
}
let prisma: ReturnType<typeof mkPrisma>;
beforeEach(() => {
  prisma = mkPrisma();
});

describe("commitTemplates", () => {
  it("nuevo → create con workspaceId, status draft, checksum", async () => {
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue(null);
    prisma.recurringInvoiceTemplate.create.mockResolvedValue({});
    const r = await commitTemplates(prisma as any, "w1", "CSV_IMPORT", [tpl()], "u1");
    expect(r.created).toBe(1);
    const data = prisma.recurringInvoiceTemplate.create.mock.calls[0][0].data;
    expect(data.workspaceId).toBe("w1");
    expect(data.status).toBe("draft");
    expect(data.checksum).toBeTruthy();
    expect(data.source).toBe("CSV_IMPORT");
  });

  it("mismo checksum → sin cambios (idempotente, no escribe)", async () => {
    const t = tpl();
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue({ id: "e1", checksum: t.checksum });
    const r = await commitTemplates(prisma as any, "w1", "CSV_IMPORT", [t], "u1");
    expect(r.unchanged).toBe(1);
    expect(prisma.recurringInvoiceTemplate.create).not.toHaveBeenCalled();
    expect(prisma.recurringInvoiceTemplate.updateMany).not.toHaveBeenCalled();
  });

  it("checksum distinto → update con workspaceId en el where (tenant)", async () => {
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue({ id: "e1", checksum: "viejo" });
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 1 });
    const r = await commitTemplates(prisma as any, "w1", "CSV_IMPORT", [tpl()], "u1");
    expect(r.updated).toBe(1);
    expect(prisma.recurringInvoiceTemplate.updateMany.mock.calls[0][0].where).toMatchObject({ id: "e1", workspaceId: "w1" });
  });

  it("carrera P2002 → contada como sin cambios (no rompe)", async () => {
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue(null);
    prisma.recurringInvoiceTemplate.create.mockRejectedValue({ code: "P2002" });
    const r = await commitTemplates(prisma as any, "w1", "CSV_IMPORT", [tpl()], "u1");
    expect(r.unchanged).toBe(1);
    expect(r.errors).toHaveLength(0);
  });
});
