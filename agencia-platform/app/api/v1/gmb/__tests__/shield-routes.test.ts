/**
 * Escudo de reputación: centro de retiradas (transiciones, apelaciones), perfiles y aislamiento por workspace.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma, completeMock } = vi.hoisted(() => {
  const db: any = { gmbReviewCase: [], gmbReviewerProfile: [], gmbEvidence: [], gmbReviewWatch: [], gmbClient: [], workspace: [], user: [] };
  const ok = (val: any, cond: any) => (cond && typeof cond === "object" && !Array.isArray(cond) && "in" in cond ? cond.in.includes(val) : val === cond);
  const match = (r: any, where: any = {}) => Object.entries(where).every(([k, v]: any) => ok(r[k], v));
  const coll = (name: string) => ({
    findFirst: vi.fn(async ({ where }: any) => db[name].find((r: any) => match(r, where)) ?? null),
    // Claves compuestas de Prisma (workspaceId_contributorId: {...}) → se aplanan.
    findUnique: vi.fn(async ({ where }: any) => {
      const flat = Object.fromEntries(Object.entries(where).flatMap(([k, v]: any) => (v && typeof v === "object" && k.includes("_") ? Object.entries(v) : [[k, v]])));
      return db[name].find((r: any) => match(r, flat)) ?? null;
    }),
    findMany: vi.fn(async ({ where }: any = {}) => db[name].filter((r: any) => match(r, where))),
    count: vi.fn(async ({ where }: any = {}) => db[name].filter((r: any) => match(r, where)).length),
    create: vi.fn(async ({ data }: any) => { const r = { id: `${name}${db[name].length + 1}`, ...data }; db[name].push(r); return r; }),
    updateMany: vi.fn(async ({ where, data }: any) => { let n = 0; for (const r of db[name]) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; }),
    deleteMany: vi.fn(async ({ where }: any) => { const before = db[name].length; db[name] = db[name].filter((r: any) => !match(r, where)); return { count: before - db[name].length }; })
  });
  const p: any = { _db: db };
  for (const n of Object.keys(db)) p[n] = coll(n);
  return { authenticateMock: vi.fn(), prisma: p, completeMock: vi.fn() };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/ai/anthropic", () => ({ complete: completeMock, completeJson: vi.fn(), DEFAULT_MODEL: "test-model" }));
vi.mock("@/lib/api/auth", async (importActual) => ({ ...(await importActual() as any), authenticate: authenticateMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { PATCH as casePatch, GET as caseGet } from "../shield/cases/[id]/route";
import { GET as appealsGet, POST as appealsPost, PATCH as appealsPatch } from "../shield/appeals/route";
import { PATCH as profilePatch } from "../shield/profiles/[id]/route";
import { POST as watchPost } from "../shield/watches/route";

const req = (method: string, body?: any) =>
  new NextRequest("https://hub.example/x", { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });

const kase = (o: any) => ({
  id: o.id, workspaceId: o.ws ?? "w1", target: "cliente", placeKey: "0xaaa:0x111", placeTitle: "Bar Sol", placeUrl: "", reviewId: o.id, reviewLink: "https://maps/r",
  author: o.author ?? "Ana", authorLink: "", contributorId: "c1", rating: 1, reviewDate: "2026-09-01", text: "Fatal", googleOption: "soez", status: o.status ?? "preparada",
  reasons: [{ kind: "policy", category: "lenguaje_obsceno", label: "Lenguaje obsceno", policy: "Contenido ofensivo", detail: "«mierda»" }],
  appealText: null, legalText: null, appealBatch: null, score: 70, likelihood: "alta", channel: "tool", reportedAt: null, appealedAt: null, removedAt: null, checkLog: null
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(prisma._db)) prisma._db[k].length = 0;
  prisma._db.workspace.push({ id: "w1", name: "Negocio Vivo", settings: {} });
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

describe("centro de retiradas", () => {
  it("denunciar → rechazada prepara la apelación (IA o plantilla) → apelada", async () => {
    prisma._db.gmbReviewCase.push(kase({ id: "k1" }));
    let r = await casePatch(req("PATCH", { action: "report" }), { params: { id: "k1" } });
    expect(r.status).toBe(200);
    expect(prisma._db.gmbReviewCase[0].status).toBe("denunciada");
    expect(prisma._db.gmbReviewCase[0].reportedAt).toBeInstanceOf(Date);

    completeMock.mockRejectedValueOnce(new Error("sin IA"));
    r = await casePatch(req("PATCH", { action: "reject" }), { params: { id: "k1" } });
    expect(r.status).toBe(200);
    const c = prisma._db.gmbReviewCase[0];
    expect(c.status).toBe("rechazada");
    expect(c.appealText).toContain("Asunto:");
    expect(c.appealText).toContain("Negocio Vivo");

    r = await casePatch(req("PATCH", { action: "appeal" }), { params: { id: "k1" } });
    expect(prisma._db.gmbReviewCase[0].status).toBe("apelada");
  });

  it("transición inválida → 409 y no cambia nada", async () => {
    prisma._db.gmbReviewCase.push(kase({ id: "k1" }));
    const r = await casePatch(req("PATCH", { action: "appeal" }), { params: { id: "k1" } });
    expect(r.status).toBe(409);
    expect(prisma._db.gmbReviewCase[0].status).toBe("preparada");
  });

  it("otro workspace → 404", async () => {
    prisma._db.gmbReviewCase.push(kase({ id: "k1", ws: "otro" }));
    expect((await casePatch(req("PATCH", { action: "report" }), { params: { id: "k1" } })).status).toBe(404);
    expect((await caseGet(req("GET"), { params: { id: "k1" } })).status).toBe(404);
    expect(prisma._db.gmbReviewCase[0].status).toBe("preparada");
  });

  it("marcar como retirada confirma el perfil del autor", async () => {
    prisma._db.gmbReviewCase.push(kase({ id: "k1", status: "denunciada" }));
    prisma._db.gmbReviewerProfile.push({ id: "p1", workspaceId: "w1", contributorId: "c1", status: "sospechoso", removedCount: 0 });
    await casePatch(req("PATCH", { action: "removed" }), { params: { id: "k1" } });
    expect(prisma._db.gmbReviewCase[0].status).toBe("retirada");
    expect(prisma._db.gmbReviewerProfile[0]).toMatchObject({ status: "confirmado", removedCount: 1 });
  });
});

describe("apelaciones en lote", () => {
  it("agrupa rechazadas por ficha, redacta y marca el lote como enviado", async () => {
    for (let i = 0; i < 3; i++) prisma._db.gmbReviewCase.push(kase({ id: `k${i}`, status: "rechazada", author: `A${i}` }));
    prisma._db.gmbReviewCase.push(kase({ id: "x", status: "rechazada", ws: "otro" }));
    const g = await (await appealsGet(req("GET"), { params: {} })).json();
    expect(g.batches).toHaveLength(1);
    expect(g.batches[0].cases).toHaveLength(3);

    completeMock.mockResolvedValueOnce("Asunto: Apelación IA\n\nTexto");
    const p = await (await appealsPost(req("POST", { caseIds: ["k0", "k1", "k2", "x"] }), { params: {} })).json();
    expect(p.text).toContain("Apelación IA");
    expect(prisma._db.gmbReviewCase.filter((c: any) => c.appealBatch === p.batchId).map((c: any) => c.id)).toEqual(["k0", "k1", "k2"]);

    const d = await (await appealsPatch(req("PATCH", { batchId: p.batchId }), { params: {} })).json();
    expect(d.updated).toBe(3);
    expect(prisma._db.gmbReviewCase.find((c: any) => c.id === "x").status).toBe("rechazada");
  });

  it("no mezcla fichas en una apelación", async () => {
    prisma._db.gmbReviewCase.push(kase({ id: "k1", status: "rechazada" }), { ...kase({ id: "k2", status: "rechazada" }), placeKey: "0xbbb:0x222" });
    expect((await appealsPost(req("POST", { caseIds: ["k1", "k2"] }), { params: {} })).status).toBe(400);
  });
});

describe("perfiles y vigilancia", () => {
  it("sólo edita perfiles del propio workspace", async () => {
    prisma._db.gmbReviewerProfile.push({ id: "p1", workspaceId: "otro", status: "sospechoso" });
    expect((await profilePatch(req("PATCH", { status: "descartado" }), { params: { id: "p1" } })).status).toBe(404);
    expect(prisma._db.gmbReviewerProfile[0].status).toBe("sospechoso");
  });

  it("crea una vigilancia y valida la ficha del hub", async () => {
    prisma.gmbReviewWatch.findFirst.mockResolvedValueOnce(null);
    const place = { title: "Bar Sol", dataId: "0xaaa:0x111", address: "", type: "Bar" };
    const r = await watchPost(req("POST", { place, emails: "a@b.com" }), { params: {} });
    expect(r.status).toBe(200);
    expect(prisma._db.gmbReviewWatch[0]).toMatchObject({ workspaceId: "w1", name: "Bar Sol", frequencyHours: 24, monthlyReport: true });
    prisma._db.gmbClient.push({ id: "g1", workspaceId: "otro" });
    expect((await watchPost(req("POST", { place: { ...place, dataId: "0xccc:0x3" }, gmbClientId: "g1" }), { params: {} })).status).toBe(404);
  });
});
