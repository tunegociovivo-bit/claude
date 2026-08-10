import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    client: { findMany: vi.fn(), findUnique: vi.fn() },
    invoice: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    invoiceIssuer: { findFirst: vi.fn() }
  }
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/invoicing/persist", () => ({
  snapshotIssuer: vi.fn(() => null),
  snapshotClient: vi.fn((client: any) => ({ name: client?.name ?? "" }))
}));

import { applyInvoiceImport, buildInvoicePlan } from "../invoices";

const input = (clientName: string) => ({
  number: "FAC-TEST",
  clientName,
  totalCents: 12100,
  currency: "EUR",
  status: "ISSUED"
});

describe("invoice client linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.invoice.findMany.mockResolvedValue([{ number: "FAC-TEST" }]);
  });

  it("matches a unique client after removing legal suffixes and descriptive tokens", async () => {
    prismaMock.client.findMany.mockResolvedValue([
      { id: "maype", name: "MAYPE COPIADORAS", taxId: null },
      { id: "vanesa", name: "Vanesa Sainz De Santiago Micropigmentación Capilar", taxId: null }
    ]);

    const [maype] = await buildInvoicePlan("ws", [input("MAYPE COPIADORAS, S.L.")]);
    const [vanesa] = await buildInvoicePlan("ws", [input("Vanesa Sainz De Santiago")]);

    expect(maype.clientMatchId).toBe("maype");
    expect(vanesa.clientMatchId).toBe("vanesa");
  });

  it("does not link an ambiguous exact or fuzzy name", async () => {
    prismaMock.client.findMany.mockResolvedValue([
      { id: "a", name: "MAYPE COPIADORAS", taxId: null },
      { id: "b", name: "MAYPE COPIADORAS", taxId: null }
    ]);

    const [plan] = await buildInvoicePlan("ws", [input("MAYPE COPIADORAS, S.L.")]);

    expect(plan.clientMatchId).toBeUndefined();
    expect(plan.clientUnmatched).toBe(true);
  });

  it("uses an optimistic tenant-scoped guard and preserves an existing snapshot", async () => {
    const updatedAt = new Date("2026-08-10T10:00:00Z");
    prismaMock.client.findMany.mockResolvedValue([{ id: "maype", name: "MAYPE COPIADORAS", taxId: null }]);
    prismaMock.invoiceIssuer.findFirst.mockResolvedValue(null);
    prismaMock.invoice.findFirst.mockResolvedValue({
      id: "invoice-1",
      clientId: null,
      clientSnapshot: { name: "MAYPE COPIADORAS, S.L." },
      updatedAt
    });
    prismaMock.client.findUnique.mockResolvedValue({ id: "maype", name: "MAYPE COPIADORAS" });
    prismaMock.invoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(applyInvoiceImport("ws", [input("MAYPE COPIADORAS, S.L.")])).resolves.toEqual({ created: 0, skipped: 1 });

    expect(prismaMock.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: "invoice-1", workspaceId: "ws", updatedAt, clientId: null },
      data: { clientId: "maype" }
    });
  });
});
