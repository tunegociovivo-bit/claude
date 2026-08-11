/**
 * Slice B — POST backfill: flag, admin, tenant, modos preview(dry-run)/commit/rollback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: {
    membership: { findFirst: vi.fn() },
    invoice: { findMany: vi.fn() },
    recurringInvoiceTemplate: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() }
  }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { POST } from "../route";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.HUB_RECURRING_INVOICES = "on";
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
  prisma.invoice.findMany.mockResolvedValue([]);
  prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([]);
  prisma.recurringInvoiceTemplate.deleteMany.mockResolvedValue({ count: 0 });
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = (body: any) => POST(new NextRequest("https://h/x", { method: "POST", body: JSON.stringify(body) }), { params: {} });

describe("POST backfill", () => {
  it("flag off → 404", async () => {
    delete process.env.HUB_RECURRING_INVOICES;
    expect((await call({ mode: "preview" })).status).toBe(404);
  });
  it("no-admin → 403", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    expect((await call({ mode: "preview" })).status).toBe(403);
  });
  it("preview por defecto (sin mode) → dry-run, no escribe", async () => {
    const body = await (await call({})).json();
    expect(body.mode).toBe("preview");
    expect(prisma.recurringInvoiceTemplate.create).not.toHaveBeenCalled();
    expect(prisma.recurringInvoiceTemplate.deleteMany).not.toHaveBeenCalled();
    // tenant
    expect(prisma.invoice.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
  });
  it("commit → escribe (idempotente)", async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: "a", workspaceId: "w1", type: "NORMAL", series: "FAC", issuerId: null, clientId: "c1", issuerSnapshot: null, clientSnapshot: { name: "Acme" }, currency: "EUR", paymentMethod: "TRANSFER", lines: [{ description: "C", quantity: 1, unitPriceCents: 10000, taxRate: 21 }], subtotalCents: 10000, taxCents: 2100, totalCents: 12100, issueDate: new Date("2026-01-01Z"), recurrenceConfig: { intervalMonths: 1 } }
    ]);
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue(null);
    prisma.recurringInvoiceTemplate.create.mockResolvedValue({});
    const body = await (await call({ mode: "commit" })).json();
    expect(body.mode).toBe("commit");
    expect(body.created).toBe(1);
  });
  it("rollback → deleteMany solo LEGACY_INVOICE", async () => {
    prisma.recurringInvoiceTemplate.deleteMany.mockResolvedValue({ count: 2 });
    const body = await (await call({ mode: "rollback" })).json();
    expect(body.deleted).toBe(2);
    expect(prisma.recurringInvoiceTemplate.deleteMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "w1", source: "LEGACY_INVOICE" });
  });
});
