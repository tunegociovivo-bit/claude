/**
 * Slice C — endpoint shadow-run: doble flag (recurrentes + motor), admin, tenant,
 * POST ejecuta previews, GET lista.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: {
    membership: { findFirst: vi.fn() },
    recurringInvoiceTemplate: { findMany: vi.fn() },
    recurringInvoicePreview: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() }
  }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { POST, GET } from "../route";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.HUB_RECURRING_INVOICES = "on";
  process.env.HUB_RECURRING_ENGINE = "on";
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
  prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([]);
  prisma.recurringInvoicePreview.findMany.mockResolvedValue([]);
});
afterEach(() => {
  process.env = { ...ORIG };
});

const post = () => POST(new NextRequest("https://h/x", { method: "POST" }), { params: {} });
const get = () => GET(new NextRequest("https://h/x", { method: "GET" }), { params: {} });

describe("shadow-run", () => {
  it("motor off (engine flag) → 404 aunque recurrentes on", async () => {
    delete process.env.HUB_RECURRING_ENGINE;
    expect((await post()).status).toBe(404);
  });
  it("recurrentes off → 404", async () => {
    delete process.env.HUB_RECURRING_INVOICES;
    expect((await post()).status).toBe(404);
  });
  it("no-admin → 403", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    expect((await post()).status).toBe(403);
  });
  it("POST admin → ejecuta shadow (mode:shadow), tenant", async () => {
    const body = await (await post()).json();
    expect(body.mode).toBe("shadow");
    expect(prisma.recurringInvoiceTemplate.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
  });
  it("GET → lista previews scoped por workspace", async () => {
    await get();
    expect(prisma.recurringInvoicePreview.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
  });
});
