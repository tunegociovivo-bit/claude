/**
 * Contrato FASE 4a — ruta GET /api/v1/exceptions: kill-switch, tenant en TODA
 * consulta, y composición/orden desde el motor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, callerIsAdminMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  callerIsAdminMock: vi.fn(),
  prisma: {
    aiDraft: { findMany: vi.fn() },
    aiAgentRun: { findMany: vi.fn() },
    invoice: { findMany: vi.fn(), count: vi.fn() },
    task: { findMany: vi.fn(), count: vi.fn() }
  }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/permissions", () => ({ callerIsAdmin: callerIsAdminMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { GET } from "../route";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HUB_EXCEPTIONS;
  delete process.env.HUB_EXCEPTIONS_ACTIONS; // acciones server off en estos tests (localStorage)
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  callerIsAdminMock.mockResolvedValue(true);
  prisma.aiDraft.findMany.mockResolvedValue([]);
  prisma.aiAgentRun.findMany.mockResolvedValue([]);
  prisma.invoice.findMany.mockResolvedValue([]);
  prisma.task.findMany.mockResolvedValue([]);
  prisma.invoice.count.mockResolvedValue(0);
  prisma.task.count.mockResolvedValue(0);
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = (qs = "") => GET(new NextRequest(`https://hub.example/api/v1/exceptions${qs}`, { method: "GET" }), { params: {} });

describe("GET /api/v1/exceptions", () => {
  it("kill-switch HUB_EXCEPTIONS=off → 404, sin consultas", async () => {
    process.env.HUB_EXCEPTIONS = "off";
    const res = await call();
    expect(res.status).toBe(404);
    expect(prisma.aiDraft.findMany).not.toHaveBeenCalled();
  });

  it("TENANT: las 4 consultas llevan workspaceId", async () => {
    await call();
    for (const m of [prisma.aiDraft, prisma.aiAgentRun, prisma.invoice, prisma.task]) {
      expect(m.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
    }
  });

  it("compone, deduplica y ordena por severidad; no expone importes €", async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: "i1", number: "F", status: "ISSUED", totalCents: 500000, paidCents: 0, dueDate: new Date(Date.now() - 40 * 86_400_000), clientId: "c1" }
    ]);
    prisma.task.findMany.mockResolvedValue([
      { id: "t1", title: "X", dueDate: new Date(Date.now() - 2 * 86_400_000), completedAt: null, clientId: "c2" }
    ]);
    const body = await (await call("?limit=50")).json();
    expect(body.total).toBe(2);
    expect(body.items[0].severity).toBe("critical"); // la factura vencida hace 40d
    expect(body.summary.critical).toBe(1);
    // ningún ítem lleva importe en €
    expect(JSON.stringify(body)).not.toMatch(/5000,00|5\.000|€/);
    expect(body.items[0].why).toBeTruthy();
    expect(body.items[0].needsFromMe).toBeTruthy();
  });

  it("no-admin: NO consulta facturas (billing excluido); admin sí", async () => {
    callerIsAdminMock.mockResolvedValue(false);
    await call();
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    vi.clearAllMocks();
    authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
    callerIsAdminMock.mockResolvedValue(true);
    for (const m of [prisma.aiDraft, prisma.aiAgentRun, prisma.invoice, prisma.task]) m.findMany.mockResolvedValue([]);
    prisma.invoice.count.mockResolvedValue(0);
    prisma.task.count.mockResolvedValue(0);
    await call();
    expect(prisma.invoice.findMany).toHaveBeenCalled();
  });

  it("filtro inválido → sin filtro (bandeja completa, no vacía)", async () => {
    prisma.task.findMany.mockResolvedValue([{ id: "t1", title: "X", dueDate: new Date(Date.now() - 2 * 86_400_000), completedAt: null, clientId: null }]);
    const body = await (await call("?severity=NOPE")).json();
    expect(body.total).toBe(1); // el valor inválido se ignora, no filtra a vacío
  });

  it("filtro por source", async () => {
    prisma.task.findMany.mockResolvedValue([{ id: "t1", title: "X", dueDate: new Date(Date.now() - 2 * 86_400_000), completedAt: null, clientId: null }]);
    prisma.invoice.findMany.mockResolvedValue([{ id: "i1", number: "F", status: "ISSUED", totalCents: 100, paidCents: 0, dueDate: new Date(Date.now() - 40 * 86_400_000), clientId: "c1" }]);
    const body = await (await call("?source=task")).json();
    expect(body.total).toBe(1);
    expect(body.items[0].source).toBe("task");
  });
});
