/**
 * Fase 4 rutas: Rank measure (bloqueo honesto sin proveedor) + transición de posts (aprobación).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma, resolveRankProviderMock } = vi.hoisted(() => {
  const db: any = { gmbClient: [], gmbPost: [], gmbKeyword: [], gmbRankConfig: [], gmbRankJob: [] };
  const findFirst = (coll: string) => vi.fn(async ({ where }: any) => db[coll].find((r: any) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null);
  const findMany = (coll: string) => vi.fn(async () => db[coll]);
  const updateMany = (coll: string) => vi.fn(async ({ where, data }: any) => { let n = 0; for (const r of db[coll]) if (Object.entries(where).every(([k, v]) => r[k] === v)) { Object.assign(r, data); n++; } return { count: n }; });
  const create = (coll: string) => vi.fn(async ({ data }: any) => { const r = { id: `${coll}${db[coll].length + 1}`, ...data }; db[coll].push(r); return r; });
  const prismaObj: any = { _db: db };
  for (const c of ["gmbClient", "gmbPost", "gmbKeyword", "gmbRankConfig", "gmbRankJob"]) prismaObj[c] = { findFirst: findFirst(c), findMany: findMany(c), updateMany: updateMany(c), create: create(c), deleteMany: vi.fn(async () => ({ count: 1 })) };
  return { authenticateMock: vi.fn(), prisma: prismaObj, resolveRankProviderMock: vi.fn() };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => ({ ...(await importActual() as any), authenticate: authenticateMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));
vi.mock("@/lib/gmb/rank-adapter", async (importActual) => ({ ...(await importActual() as any), resolveRankProvider: resolveRankProviderMock }));
vi.mock("@/lib/integrations/gmb-hub", () => ({ logGmbActivity: vi.fn(async () => {}) }));

import { POST as measurePost } from "../clients/[id]/rank/measure/route";
import { PATCH as postPatch } from "../clients/[id]/posts/[postId]/route";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(prisma._db)) prisma._db[k].length = 0;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});
const jsonReq = (body: any) => new NextRequest("https://h/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("rank/measure — bloqueo honesto sin proveedor", () => {
  it("sin proveedor → blocked, sin encolar", async () => {
    prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1", latitude: 36.7, longitude: -4.4 });
    resolveRankProviderMock.mockResolvedValue(null);
    const res = await measurePost(jsonReq({ keyword: "cafeteria" }), { params: { id: "cl1" } });
    const body = await res.json();
    expect(body.blocked).toBe(true);
    expect(body.reason).toBe("sin_proveedor");
    expect(prisma._db.gmbRankJob.length).toBe(0);
  });
  it("con proveedor + coords + keyword → encola", async () => {
    prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1", latitude: 36.7, longitude: -4.4 });
    prisma._db.gmbKeyword.push({ workspaceId: "w1", clientId: "cl1", keyword: "cafeteria" });
    resolveRankProviderMock.mockResolvedValue({ id: "fake", measure: async () => ({}) });
    const res = await measurePost(jsonReq({}), { params: { id: "cl1" } });
    const body = await res.json();
    expect(body.blocked).toBe(false);
    expect(body.enqueued).toBe(1);
  });
});

describe("posts/[postId] PATCH — transición con aprobación", () => {
  const patch = (postId: string, body: any) => postPatch(new NextRequest("https://h/x", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: { id: "cl1", postId } });
  beforeEach(() => { prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1", name: "Café" }); });
  it("404 para post de otro workspace", async () => {
    prisma._db.gmbPost.push({ id: "p1", workspaceId: "otro", clientId: "cl1", status: "draft" });
    expect((await patch("p1", { command: "submit" })).status).toBe(404);
  });
  it("'publish' NO es un comando manual (publicación solo por el adapter) → 400", async () => {
    prisma._db.gmbPost.push({ id: "p1", workspaceId: "w1", clientId: "cl1", status: "scheduled", title: "T", content: "c" });
    expect((await patch("p1", { command: "publish" })).status).toBe(400);
  });
  it("programar saltándose la aprobación (draft→schedule) → 409", async () => {
    prisma._db.gmbPost.push({ id: "p1", workspaceId: "w1", clientId: "cl1", status: "draft", title: "T", content: "c" });
    expect((await patch("p1", { command: "schedule", scheduledAt: "2030-01-01" })).status).toBe(409);
  });
  it("approve fija aprobador", async () => {
    prisma._db.gmbPost.push({ id: "p1", workspaceId: "w1", clientId: "cl1", status: "pending_approval", title: "T", content: "c" });
    const res = await patch("p1", { command: "approve" });
    expect((await res.json()).status).toBe("approved");
    expect(prisma._db.gmbPost[0].approvedById).toBe("u1");
  });
});
