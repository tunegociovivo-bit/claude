/**
 * Contrato FASE 2 · objetivo 2 — ruta GET /api/v1/clients/search (end-to-end,
 * prisma y auth mockeados). Verifica select mínimo, cursor y count opcional.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: { client: { findMany: vi.fn(), count: vi.fn() } }
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
// callerIsAdmin no se usa aquí, pero handler.ts lo importa: mock ligero.
vi.mock("@/lib/api/permissions", () => ({ callerIsAdmin: vi.fn(async () => true) }));
vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 })
}));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

function call(qs: string) {
  const req = new NextRequest(`https://hub.example/api/v1/clients/search${qs}`, { method: "GET" });
  return GET(req, { params: {} });
}

describe("GET /api/v1/clients/search", () => {
  it("devuelve items mínimos y nextCursor cuando hay más (limit+1)", async () => {
    // 21 filas para limit=20 → hay página siguiente.
    prisma.client.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, name: `N${i}`, status: "ACTIVE" }))
    );
    const res = await call("?q=bar&limit=20");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(20);
    expect(body.nextCursor).toBe("c19");
    expect(body.total).toBeUndefined();
    // Acota por workspace y pide select mínimo.
    const args = prisma.client.findMany.mock.calls[0][0];
    expect(args.where.workspaceId).toBe("w1");
    expect(args.select).toEqual({ id: true, name: true, status: true });
    expect(args.take).toBe(21);
    expect(prisma.client.count).not.toHaveBeenCalled();
  });

  it("withCount=1 añade total con una query de count", async () => {
    prisma.client.findMany.mockResolvedValue([{ id: "c0", name: "N0", status: "ACTIVE" }]);
    prisma.client.count.mockResolvedValue(7);
    const res = await call("?withCount=1");
    const body = await res.json();
    expect(body.total).toBe(7);
    expect(body.nextCursor).toBeNull();
    expect(prisma.client.count).toHaveBeenCalledTimes(1);
  });

  it("cursor → skip 1", async () => {
    prisma.client.findMany.mockResolvedValue([]);
    await call("?cursor=cX");
    const args = prisma.client.findMany.mock.calls[0][0];
    expect(args.cursor).toEqual({ id: "cX" });
    expect(args.skip).toBe(1);
  });
});
