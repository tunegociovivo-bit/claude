/**
 * Parche de seguridad — ruta de LISTA /clients: misma allowlist por rol que
 * /clients/[id] (la fuga estaba también aquí, revisión independiente).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, callerIsAdminMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  callerIsAdminMock: vi.fn(),
  prisma: { client: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() } }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/permissions", () => ({ callerIsAdmin: callerIsAdminMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));
vi.mock("@/lib/search/embeddings", () => ({ indexEntity: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/search/indexers", () => ({ textForClient: () => "" }));

import { GET, POST } from "../route";

const ROW = { id: "c1", workspaceId: "w1", name: "Bar", status: "ACTIVE", mrr: 500, accesos: "SECRET-pass", taxId: "B1", stripeCustomerId: "cus_1", metaPageId: "pg" };

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.client.count.mockResolvedValue(1);
});

describe("GET /clients (lista) — allowlist por rol", () => {
  it("no-admin: los items NO llevan accesos/mrr/taxId/stripe/meta", async () => {
    callerIsAdminMock.mockResolvedValue(false);
    prisma.client.findMany.mockResolvedValue([ROW]);
    const res = await GET(new NextRequest("https://hub.example/api/v1/clients"), { params: {} });
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    for (const k of ["accesos", "mrr", "taxId", "stripeCustomerId", "metaPageId"]) expect(body.items[0][k]).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("SECRET-pass");
    expect(body.items[0].name).toBe("Bar");
  });

  it("admin: ve mrr/accesos/taxId pero no stripe/meta", async () => {
    callerIsAdminMock.mockResolvedValue(true);
    prisma.client.findMany.mockResolvedValue([ROW]);
    const body = await (await GET(new NextRequest("https://hub.example/api/v1/clients"), { params: {} })).json();
    expect(body.items[0].mrr).toBe(500);
    expect(body.items[0].accesos).toBe("SECRET-pass");
    expect(body.items[0].stripeCustomerId).toBeUndefined();
  });
});

describe("POST /clients — no-admin no escribe ni recibe sensibles", () => {
  it("descarta sensibles del create y de la respuesta", async () => {
    callerIsAdminMock.mockResolvedValue(false);
    prisma.client.create.mockResolvedValue(ROW);
    const res = await POST(
      new NextRequest("https://hub.example/api/v1/clients", { method: "POST", body: JSON.stringify({ name: "Bar", mrr: 999, accesos: "hack", metaPageId: "x" }) }),
      { params: {} }
    );
    expect(res.status).toBe(201);
    const sent = prisma.client.create.mock.calls[0][0].data;
    expect(sent.mrr).toBeUndefined();
    expect(sent.accesos).toBeUndefined();
    expect(sent.metaPageId).toBeUndefined();
    const body = await res.json();
    expect(body.accesos).toBeUndefined();
    expect(body.stripeCustomerId).toBeUndefined();
  });
});
