/**
 * Slice D — endpoint pausa: doble flag, admin, tenant, preview dry-run, commit con
 * frase incorrecta → 400 sin escribir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: {
    membership: { findFirst: vi.fn() },
    recurringInvoiceTemplate: { findMany: vi.fn(), updateMany: vi.fn() },
    recurringPauseOperation: { create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    auditLog: { create: vi.fn() }
  }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { POST } from "../route";
import { expectedPhrase } from "@/lib/facturacion/recurring/pause-plan";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.HUB_RECURRING_INVOICES = "on";
  process.env.HUB_RECURRING_PAUSE = "on";
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
  prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([{ id: "a", status: "active", statusBeforePause: null, clientSnapshot: null }]);
  prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 1 });
  prisma.recurringPauseOperation.create.mockResolvedValue({ id: "op1" });
  prisma.recurringPauseOperation.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = (body: any) => POST(new NextRequest("https://h/x", { method: "POST", body: JSON.stringify(body) }), { params: {} });

describe("POST pause", () => {
  it("flag pausa off → 404 aunque recurrentes on", async () => {
    delete process.env.HUB_RECURRING_PAUSE;
    expect((await call({ mode: "preview", action: "pause", ids: ["a"] })).status).toBe(404);
  });
  it("no-admin → 403", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    expect((await call({ mode: "preview", action: "pause", ids: ["a"] })).status).toBe(403);
  });
  it("preview → dry-run, no escribe", async () => {
    const body = await (await call({ mode: "preview", action: "pause", ids: ["a"] })).json();
    expect(body.mode).toBe("preview");
    expect(body.phrase).toBe(expectedPhrase("pause", 1, "w1"));
    expect(prisma.recurringInvoiceTemplate.updateMany).not.toHaveBeenCalled();
  });
  it("commit con frase incorrecta → 400, no escribe", async () => {
    const res = await call({ mode: "commit", action: "pause", ids: ["a"], phrase: "mala" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("phrase_mismatch");
    expect(prisma.recurringInvoiceTemplate.updateMany).not.toHaveBeenCalled();
  });
  it("commit con frase correcta → pausa, tenant en la carga", async () => {
    const body = await (await call({ mode: "commit", action: "pause", ids: ["a"], phrase: expectedPhrase("pause", 1, "w1") })).json();
    expect(body.status).toBe("completed");
    expect(prisma.recurringInvoiceTemplate.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
  });
});
