import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany, findUnique, notifyJobEmail } = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  notifyJobEmail: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { sepaRemittanceRequest: { updateMany, findUnique } }
}));
vi.mock("../remittance", () => ({ notifyJobEmail }));

import { notifyPendingSignatureRequestOnce } from "../pending-signature-notification";

describe("notifyPendingSignatureRequestOnce", () => {
  beforeEach(() => vi.clearAllMocks());

  it("envía un único aviso aunque la recuperación se ejecute varias veces", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    findUnique.mockResolvedValue({
      id: "req-1", clientName: "Cliente", invoiceNumber: "FAC-1",
      amountCents: 1000, currency: "EUR"
    });
    notifyJobEmail.mockResolvedValue(undefined);

    expect(await notifyPendingSignatureRequestOnce("ws-1", "req-1")).toBe(true);
    expect(await notifyPendingSignatureRequestOnce("ws-1", "req-1")).toBe(false);
    expect(notifyJobEmail).toHaveBeenCalledTimes(1);
  });

  it("libera la marca si el proveedor de correo falla para permitir un reintento", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValue({
      id: "req-1", clientName: "Cliente", invoiceNumber: "FAC-1",
      amountCents: 1000, currency: "EUR"
    });
    notifyJobEmail.mockRejectedValue(new Error("smtp caído"));

    await expect(notifyPendingSignatureRequestOnce("ws-1", "req-1")).rejects.toThrow("smtp caído");
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0].data).toEqual({ pendingSignatureNotifiedAt: null });
  });
});
