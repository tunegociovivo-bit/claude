/**
 * Parche de seguridad — ruta GET/PATCH /clients/[id]: allowlist por rol,
 * tenant, 404, y no-admin no escribe campos sensibles.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, callerIsAdminMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  callerIsAdminMock: vi.fn(),
  prisma: { client: { findFirst: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() } }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/permissions", () => ({ callerIsAdmin: callerIsAdminMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));
vi.mock("@/lib/audit/log", () => ({ auditFromReq: vi.fn() }));
vi.mock("@/lib/webhooks/dispatch", () => ({ dispatchWebhook: vi.fn() }));
vi.mock("@/lib/search/embeddings", () => ({ indexEntity: vi.fn(() => Promise.resolve()), deleteEntityIndex: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/search/indexers", () => ({ textForClient: () => "" }));

import { GET, PATCH } from "../route";

const CLIENT = { id: "c1", workspaceId: "w1", name: "Bar", status: "ACTIVE", mrr: 500, accesos: "SECRET-pass", taxId: "B1", stripeCustomerId: "cus_1", metaPageId: "pg" };

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

const req = (m = "GET", body?: any) =>
  new NextRequest("https://hub.example/api/v1/clients/c1", { method: m, ...(body ? { body: JSON.stringify(body) } : {}) });

describe("GET /clients/[id] — allowlist por rol", () => {
  it("no-admin (miembro/guest): sin accesos/mrr/taxId/stripe/meta; tenant scoped", async () => {
    callerIsAdminMock.mockResolvedValue(false);
    prisma.client.findFirst.mockResolvedValue(CLIENT);
    const res = await GET(req(), { params: { id: "c1" } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.name).toBe("Bar");
    for (const k of ["accesos", "mrr", "taxId", "stripeCustomerId", "metaPageId"]) expect(body[k]).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("SECRET-pass");
    expect(prisma.client.findFirst.mock.calls[0][0].where).toMatchObject({ id: "c1", workspaceId: "w1", deletedAt: null });
  });

  it("admin: ve accesos/mrr/taxId pero NUNCA stripe/meta", async () => {
    callerIsAdminMock.mockResolvedValue(true);
    prisma.client.findFirst.mockResolvedValue(CLIENT);
    const body = await (await GET(req(), { params: { id: "c1" } })).json();
    expect(body.mrr).toBe(500);
    expect(body.accesos).toBe("SECRET-pass");
    expect(body.taxId).toBe("B1");
    expect(body.stripeCustomerId).toBeUndefined();
    expect(body.metaPageId).toBeUndefined();
  });

  it("404 si no existe (tenant)", async () => {
    callerIsAdminMock.mockResolvedValue(true);
    prisma.client.findFirst.mockResolvedValue(null);
    const res = await GET(req(), { params: { id: "c1" } });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /clients/[id] — no-admin no escribe campos sensibles", () => {
  it("descarta mrr/accesos/taxId del payload de un no-admin", async () => {
    callerIsAdminMock.mockResolvedValue(false);
    prisma.client.findFirst.mockResolvedValue({ id: "c1", name: "Bar", mrr: 500, status: "ACTIVE" });
    prisma.client.updateMany.mockResolvedValue({ count: 1 });
    prisma.client.findUnique.mockResolvedValue(CLIENT);
    await PATCH(req("PATCH", { name: "Nuevo", mrr: 999, accesos: "hack", taxId: "X" }), { params: { id: "c1" } });
    const data = prisma.client.updateMany.mock.calls[0][0].data;
    expect(data.name).toBe("Nuevo");
    expect(data.mrr).toBeUndefined();
    expect(data.accesos).toBeUndefined();
    expect(data.taxId).toBeUndefined();
  });
});
