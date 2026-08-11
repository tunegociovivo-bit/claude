/**
 * Contrato FASE 2 · objetivo 1 — ruta índice de conversaciones (wiring).
 * prisma.$queryRaw / auth mockeados: verifica la forma de la respuesta y que
 * el total/unread vienen del count SQL (no del recuento de la página).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: { $queryRaw: vi.fn() }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/permissions", () => ({ callerIsAdmin: vi.fn(async () => true) }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

function call(qs = "") {
  return GET(new NextRequest(`https://hub.example/api/v1/leads/inbox/conversations/index${qs}`, { method: "GET" }), { params: {} });
}

describe("GET conversations/index", () => {
  it("devuelve items + nextCursor y total/unread del count SQL", async () => {
    // 1ª llamada = página (31 filas para limit 30 → hay más); 2ª = counts.
    const rows = Array.from({ length: 31 }, (_, i) => ({ phone: `p${i}`, lastAt: new Date(Date.UTC(2026, 7, 11, 10, 0, 31 - i)), unread: i % 2 }));
    prisma.$queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([{ total: 123, totalUnread: 45 }]);

    const res = await call("?limit=30");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(30);
    expect(body.nextCursor).toBeTypeOf("string");
    expect(body.total).toBe(123); // del count SQL, NO body.items.length
    expect(body.totalUnread).toBe(45);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("página final: nextCursor null y counts a 0 si vacío", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const body = await (await call()).json();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.total).toBe(0);
    expect(body.totalUnread).toBe(0);
  });
});
