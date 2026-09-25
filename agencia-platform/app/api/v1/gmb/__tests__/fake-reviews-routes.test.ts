/**
 * Detector de reseñas falsas: aislamiento por workspace, validación y enlace compartible.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const db: any = { gmbFakeReviewAnalysis: [], gmbClient: [] };
  const match = (r: any, where: any) => Object.entries(where).every(([k, v]: any) => r[k] === v);
  const coll = (name: string) => ({
    findFirst: vi.fn(async ({ where }: any) => db[name].find((r: any) => match(r, where)) ?? null),
    findMany: vi.fn(async ({ where }: any) => db[name].filter((r: any) => match(r, where))),
    create: vi.fn(async ({ data }: any) => { const r = { id: `${name}${db[name].length + 1}`, ...data }; db[name].push(r); return r; }),
    updateMany: vi.fn(async ({ where, data }: any) => { let n = 0; for (const r of db[name]) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
    deleteMany: vi.fn(async ({ where }: any) => { const before = db[name].length; db[name] = db[name].filter((r: any) => !match(r, where)); return { count: before - db[name].length }; })
  });
  const p: any = { _db: db };
  for (const n of Object.keys(db)) p[n] = coll(n);
  return { authenticateMock: vi.fn(), prisma: p };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/ai/anthropic", () => ({ complete: vi.fn(), DEFAULT_MODEL: "test-model" }));
vi.mock("@/lib/api/auth", async (importActual) => ({ ...(await importActual() as any), authenticate: authenticateMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { GET as listGet, POST as createPost } from "../fake-reviews/route";
import { GET as oneGet, DELETE as oneDelete } from "../fake-reviews/[id]/route";
import { POST as sharePost } from "../fake-reviews/[id]/share/route";

const req = (method: string, body?: any) =>
  new NextRequest("https://hub.example/x", { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });

const place = (title: string, dataId: string) => ({ title, dataId, address: "", rating: 4.5, reviews: 100, type: "Clínica", placeId: "", lat: 36.5, lng: -4.8, thumbnail: "" });

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(prisma._db)) prisma._db[k].length = 0;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

describe("fake-reviews", () => {
  it("crea un análisis en cola con estado inicial", async () => {
    const res = await createPost(req("POST", { client: place("Cliente", "0xaaaaaa:0x111111"), competitors: [place("Comp", "0xbbbbbb:0x222222")] }), { params: {} });
    expect(res.status).toBe(200);
    const row = prisma._db.gmbFakeReviewAnalysis[0];
    expect(row.workspaceId).toBe("w1");
    expect(row.status).toBe("running");
    expect(row.state.phase).toBe("client");
    expect(row.params.negThreshold).toBe(2);
  });

  it("modo auto: sólo el cliente, fuerza investigación profunda", async () => {
    const res = await createPost(req("POST", { mode: "auto", client: place("Cliente", "0xaaaaaa:0x111111"), deep: false }), { params: {} });
    expect(res.status).toBe(200);
    const row = prisma._db.gmbFakeReviewAnalysis[0];
    expect(row.params.mode).toBe("auto");
    expect(row.params.deep).toBe(true);
    expect(row.params.competitors).toHaveLength(0);
    expect(row.label).toContain("automática");
  });

  it("rechaza competidor igual al cliente y sin competidores", async () => {
    const c = place("Cliente", "0xaaaaaa:0x111111");
    expect((await createPost(req("POST", { client: c, competitors: [c] }), { params: {} })).status).toBe(400);
    expect((await createPost(req("POST", { client: c, competitors: [] }), { params: {} })).status).toBe(400);
  });

  it("404 si la ficha del hub es de otro workspace", async () => {
    prisma._db.gmbClient.push({ id: "cl1", workspaceId: "otro" });
    const res = await createPost(req("POST", { clientId: "cl1", client: place("Cliente", "0xaaaaaa:0x111111"), competitors: [place("Comp", "0xbbbbbb:0x222222")] }), { params: {} });
    expect(res.status).toBe(404);
  });

  it("aísla por workspace en lectura, borrado y compartir", async () => {
    prisma._db.gmbFakeReviewAnalysis.push({ id: "a1", workspaceId: "otro", status: "done" });
    expect((await oneGet(req("GET"), { params: { id: "a1" } })).status).toBe(404);
    expect((await oneDelete(req("DELETE"), { params: { id: "a1" } })).status).toBe(404);
    expect((await sharePost(req("POST", {}), { params: { id: "a1" } })).status).toBe(404);
    expect(prisma._db.gmbFakeReviewAnalysis).toHaveLength(1);
    const list = await (await listGet(req("GET"), { params: {} })).json();
    expect(list.analyses).toHaveLength(0);
  });

  it("enlace compartible: sólo con análisis terminado y guarda el hash", async () => {
    prisma._db.gmbFakeReviewAnalysis.push({ id: "a1", workspaceId: "w1", status: "running" });
    expect((await sharePost(req("POST", {}), { params: { id: "a1" } })).status).toBe(409);
    prisma._db.gmbFakeReviewAnalysis[0].status = "done";
    const res = await sharePost(req("POST", {}), { params: { id: "a1" } });
    const body = await res.json();
    expect(body.url).toContain("/informe-resenas/");
    const token = body.url.split("/informe-resenas/")[1];
    expect(prisma._db.gmbFakeReviewAnalysis[0].shareTokenHash).toBeTruthy();
    expect(prisma._db.gmbFakeReviewAnalysis[0].shareTokenHash).not.toBe(token);
  });
});
