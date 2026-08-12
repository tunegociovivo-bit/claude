/**
 * Slice E0 — endpoint readiness: doble flag, admin, tenant, SOLO lectura.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: { membership: { findFirst: vi.fn() }, recurringInvoicePreview: { findMany: vi.fn() }, invoice: { findMany: vi.fn() } }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { GET } from "../route";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.HUB_RECURRING_INVOICES = "on";
  process.env.HUB_RECURRING_ENGINE = "on";
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
  prisma.recurringInvoicePreview.findMany.mockResolvedValue([]);
  prisma.invoice.findMany.mockResolvedValue([]);
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = () => GET(new NextRequest("https://h/api/v1/facturacion/recurring-templates/readiness", { method: "GET" }), { params: {} });

describe("GET readiness", () => {
  it("flag motor off → 404", async () => {
    delete process.env.HUB_RECURRING_ENGINE;
    expect((await call()).status).toBe(404);
  });
  it("no-admin → 403", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    expect((await call()).status).toBe(403);
  });
  it("admin → informe read-only con aviso de que no se activó nada; tenant", async () => {
    const body = await (await call()).json();
    expect(body.readiness).toBeDefined();
    expect(String(body.note)).toMatch(/No se ha activado/i);
    expect(prisma.recurringInvoicePreview.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
    expect(prisma.invoice.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
  });
});
