/**
 * Contrato FASE 3 — ruta overview: kill-switch, 404, y paso de rol/tenant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, callerIsAdminMock, getOverviewMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  callerIsAdminMock: vi.fn(),
  getOverviewMock: vi.fn(),
  prisma: { workspace: { findUnique: vi.fn() } }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/permissions", () => ({ callerIsAdmin: callerIsAdminMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));
vi.mock("@/lib/clients/overview", () => ({ getClientOverview: getOverviewMock }));

import { GET } from "../route";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HUB_CLIENT360;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  callerIsAdminMock.mockResolvedValue(false);
  prisma.workspace.findUnique.mockResolvedValue({ settings: {} });
});
afterEach(() => {
  process.env = { ...ORIG };
});

function call(id = "c1") {
  return GET(new NextRequest(`https://hub.example/api/v1/clients/${id}/overview`, { method: "GET" }), { params: { id } });
}

describe("GET /api/v1/clients/[id]/overview", () => {
  it("kill-switch HUB_CLIENT360=off → 404", async () => {
    process.env.HUB_CLIENT360 = "off";
    const res = await call();
    expect(res.status).toBe(404);
    expect(getOverviewMock).not.toHaveBeenCalled();
  });

  it("cliente inexistente → 404", async () => {
    getOverviewMock.mockResolvedValue(null);
    const res = await call("nope");
    expect(res.status).toBe(404);
  });

  it("ok → 200 y pasa isAdmin + tenant + healthConfig de settings", async () => {
    callerIsAdminMock.mockResolvedValue(true);
    prisma.workspace.findUnique.mockResolvedValue({ settings: { clientHealth: { weights: { staleActivity: 33 } } } });
    getOverviewMock.mockResolvedValue({ essentials: { id: "c1" }, health: { score: 100 } });
    const res = await call();
    expect(res.status).toBe(200);
    const args = getOverviewMock.mock.calls[0][1];
    expect(args).toMatchObject({ workspaceId: "w1", clientId: "c1", isAdmin: true });
    expect(args.healthConfigPartial).toEqual({ weights: { staleActivity: 33 } });
  });
});
