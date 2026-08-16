/**
 * Rutas de lectura fase 2 (review-intel, rank): tenant isolation + serialización segura.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const db: any = { gmbClient: [], gmbReview: [], gmbKeyword: [], gmbPosition: [] };
  const findFirst = (coll: string) => vi.fn(async ({ where }: any) => db[coll].find((r: any) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null);
  const findMany = (coll: string) => vi.fn(async ({ where }: any) => db[coll].filter((r: any) => !where || Object.entries(where).every(([k, v]: any) => v == null || typeof v === "object" || r[k] === v)));
  const prismaObj: any = { _db: db };
  for (const coll of ["gmbClient", "gmbReview", "gmbKeyword", "gmbPosition"]) prismaObj[coll] = { findFirst: findFirst(coll), findMany: findMany(coll) };
  return { authenticateMock: vi.fn(), prisma: prismaObj };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => ({ ...(await importActual() as any), authenticate: authenticateMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { GET as reviewIntel } from "../clients/[id]/review-intel/route";
import { GET as rank } from "../clients/[id]/rank/route";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(prisma._db)) prisma._db[k].length = 0;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});
const get = (fn: any, id: string) => fn(new NextRequest(`https://h/x`), { params: { id } });

describe("review-intel GET", () => {
  it("404 para ficha de otro workspace", async () => {
    prisma._db.gmbClient.push({ id: "cl1", workspaceId: "otro", autoReply: "manual" });
    expect((await get(reviewIntel, "cl1")).status).toBe(404);
  });
  it("analiza reseñas y resume; negativa marcada urgente/pendiente", async () => {
    prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1", autoReply: "manual" });
    prisma._db.gmbReview.push({ id: "r1", workspaceId: "w1", clientId: "cl1", authorName: "Ana", rating: 1, comment: "fatal y lento", reviewReply: null });
    const body = await (await get(reviewIntel, "cl1")).json();
    expect(body.summary.total).toBe(1);
    const it0 = body.items[0];
    expect(it0.analysis.sentiment).toBe("negative");
    expect(it0.reply.requiresApproval).toBe(true); // auto desactivado
  });
});

describe("rank GET", () => {
  it("estado del proveedor honesto + keywords, sin posiciones fabricadas", async () => {
    prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1" });
    prisma._db.gmbKeyword.push({ workspaceId: "w1", clientId: "cl1", keyword: "cafeteria", isPrimary: true });
    const body = await (await get(rank, "cl1")).json();
    expect(body.provider.provider).toBe("google_maps");
    expect(typeof body.provider.connected).toBe("boolean");
    expect(body.keywords[0].keyword).toBe("cafeteria");
    expect(body.keywords[0].avgPosition).toBeNull(); // sin medición → null, no inventado
  });
});
