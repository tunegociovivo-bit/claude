import { describe, expect, it, vi } from "vitest";
import { permanentlyDeleteInvoice } from "../permanent-delete";

function database() {
  const tx = {
    invoice: { findFirst: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    bankTransaction: { updateMany: vi.fn() },
    remittanceJob: { findMany: vi.fn().mockResolvedValue([{ id: "job-1" }]), deleteMany: vi.fn() },
    remittanceJobEvent: { deleteMany: vi.fn() },
    sepaRemittanceRequest: { findMany: vi.fn().mockResolvedValue([{ id: "request-1" }]), deleteMany: vi.fn() },
    sepaRemittanceEvent: { deleteMany: vi.fn() }
  };
  return { tx, db: { $transaction: vi.fn((callback) => callback(tx)) } };
}

describe("permanent invoice deletion", () => {
  it("refuses to purge an invoice that is not in the trash", async () => {
    const { tx, db } = database();
    tx.invoice.findFirst.mockResolvedValue({ id: "inv-1", deletedAt: null });
    await expect(permanentlyDeleteInvoice(db as any, "workspace-1", "inv-1")).rejects.toThrow(/papelera/i);
    expect(tx.invoice.delete).not.toHaveBeenCalled();
  });

  it("removes linked banking work before deleting a trashed invoice", async () => {
    const { tx, db } = database();
    tx.invoice.findFirst.mockResolvedValue({ id: "inv-1", deletedAt: new Date() });
    await permanentlyDeleteInvoice(db as any, "workspace-1", "inv-1");
    expect(tx.bankTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace-1", matchedInvoiceId: "inv-1" } }));
    expect(tx.remittanceJob.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: "workspace-1", invoiceId: "inv-1" } });
    expect(tx.sepaRemittanceRequest.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: "workspace-1", invoiceId: "inv-1" } });
    expect(tx.invoice.delete).toHaveBeenCalledWith({ where: { id: "inv-1" } });
  });
});
