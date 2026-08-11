/**
 * Slice B — separación opt-in del listado: con HUB_RECURRING_SEPARATE=on, GET
 * /invoices EXCLUYE las plantillas legadas (recurring:false); default OFF no cambia.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: { membership: { findFirst: vi.fn() }, invoice: { findMany: vi.fn() } }
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
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
  prisma.invoice.findMany.mockResolvedValue([]);
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = () => GET(new NextRequest("https://h/api/v1/invoices", { method: "GET" }), { params: {} });

describe("GET /invoices — separación opt-in", () => {
  it("flag OFF (default) → NO filtra recurring (comportamiento actual)", async () => {
    delete process.env.HUB_RECURRING_SEPARATE;
    await call();
    expect(prisma.invoice.findMany.mock.calls[0][0].where.recurring).toBeUndefined();
  });
  it("flag ON → where.recurring:false (excluye plantillas)", async () => {
    process.env.HUB_RECURRING_SEPARATE = "on";
    await call();
    expect(prisma.invoice.findMany.mock.calls[0][0].where.recurring).toBe(false);
    // tenant intacto
    expect(prisma.invoice.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
  });
});
