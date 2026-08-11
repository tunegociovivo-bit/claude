/**
 * Contrato Slice 2b — POST /api/v1/exceptions/actions: flag, tenant en toda
 * escritura, idempotencia (upsert por clave única), auditoría y revocación.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: {
    exceptionAction: { upsert: vi.fn(), updateMany: vi.fn() },
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

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.HUB_EXCEPTIONS_ACTIONS = "on";
  delete process.env.HUB_EXCEPTIONS;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.exceptionAction.upsert.mockResolvedValue({ id: "ea1", action: "archive" });
  prisma.exceptionAction.updateMany.mockResolvedValue({ count: 1 });
  prisma.auditLog.create.mockResolvedValue({});
});
afterEach(() => {
  process.env = { ...ORIG };
});

const post = (body: any) =>
  POST(new NextRequest("https://hub.example/api/v1/exceptions/actions", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: {} });

describe("POST /api/v1/exceptions/actions", () => {
  it("flag off → 404, sin escrituras", async () => {
    process.env.HUB_EXCEPTIONS_ACTIONS = "off";
    const res = await post({ exceptionId: "task:t1", action: "archive" });
    expect(res.status).toBe(404);
    expect(prisma.exceptionAction.upsert).not.toHaveBeenCalled();
  });

  it("crea/actualiza idempotente con workspaceId (tenant) y audita", async () => {
    const res = await post({ exceptionId: "task:t1", dedupeKey: "task_blocked:task:t1", source: "task", kind: "task_blocked", action: "archive", severity: "high" });
    expect(res.status).toBe(200);
    // idempotencia: upsert por clave única con workspaceId
    const call = prisma.exceptionAction.upsert.mock.calls[0][0];
    expect(call.where.workspaceId_exceptionId_action).toMatchObject({ workspaceId: "w1", exceptionId: "task:t1", action: "archive" });
    expect(call.create.workspaceId).toBe("w1");
    // auditoría
    expect(prisma.auditLog.create).toHaveBeenCalled();
    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ workspaceId: "w1", action: "exception.archive", targetType: "exception", targetId: "task:t1" });
  });

  it("no filtra importes/PII en el meta auditado", async () => {
    await post({ exceptionId: "invoice:i1", source: "invoice", kind: "billing_problem", action: "ignore", reason: "incobrable" });
    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(JSON.stringify(audit)).not.toMatch(/€|\d+,\d{2}/);
  });

  it("revoke → updateMany con workspaceId; audita revocado", async () => {
    const res = await post({ revoke: true, exceptionId: "task:t1", action: "archive" });
    expect(res.status).toBe(200);
    const where = prisma.exceptionAction.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ workspaceId: "w1", exceptionId: "task:t1", action: "archive", revokedAt: null });
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe("exception.archive.revoked");
  });

  it("payload inválido → 400 sin escrituras", async () => {
    const res = await post({ exceptionId: "malo", action: "archive" });
    expect(res.status).toBe(400);
    expect(prisma.exceptionAction.upsert).not.toHaveBeenCalled();
  });
});
