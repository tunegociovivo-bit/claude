/**
 * Rutas del GMB Hub (fase crecimiento): aislamiento de tenant + transiciones de estado.
 * Prisma y auth mockeados; sin red.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const db: any = { gmbAction: [], gmbCitation: [], gmbCitationEvent: [], gmbClient: [], gmbNapProfile: [], gmbPost: [] };
  const findFirst = (coll: string) => vi.fn(async ({ where }: any) => db[coll].find((r: any) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null);
  const findMany = (coll: string) => vi.fn(async ({ where }: any) => db[coll].filter((r: any) => !where || Object.entries(where).every(([k, v]: any) => v == null || typeof v === "object" || r[k] === v)));
  const updateMany = (coll: string) => vi.fn(async ({ where, data }: any) => {
    let n = 0;
    for (const r of db[coll]) if (Object.entries(where).every(([k, v]) => r[k] === v)) { Object.assign(r, data); n++; }
    return { count: n };
  });
  const create = (coll: string) => vi.fn(async ({ data }: any) => { const row = { id: `${coll}_${db[coll].length + 1}`, ...data }; db[coll].push(row); return row; });
  const prismaObj: any = { _db: db };
  for (const coll of ["gmbAction", "gmbCitation", "gmbCitationEvent", "gmbClient", "gmbNapProfile", "gmbPost"]) {
    prismaObj[coll] = { findFirst: findFirst(coll), findMany: findMany(coll), updateMany: updateMany(coll), create: create(coll) };
  }
  return { authenticateMock: vi.fn(), prisma: prismaObj };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => ({ ...(await importActual() as any), authenticate: authenticateMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { PATCH as actionPatch } from "../actions/[id]/route";
import { PATCH as citationPatch } from "../citations/[id]/route";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(prisma._db)) prisma._db[k].length = 0;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

const patch = (fn: any, id: string, body: any) => fn(new NextRequest(`https://h/x`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: { id } });

describe("actions/[id] PATCH — tenant + transiciones + aprobación", () => {
  it("404 para acción de otro workspace", async () => {
    prisma._db.gmbAction.push({ id: "a1", workspaceId: "otro", status: "suggested", external: false, requiresApproval: false });
    expect((await patch(actionPatch, "a1", { command: "prepare" })).status).toBe(404);
  });
  it("transición inválida → 409", async () => {
    prisma._db.gmbAction.push({ id: "a1", workspaceId: "w1", status: "done", external: false, requiresApproval: false });
    expect((await patch(actionPatch, "a1", { command: "execute" })).status).toBe(409);
  });
  it("aprobar acción externa desde needs_approval fija aprobador", async () => {
    prisma._db.gmbAction.push({ id: "a1", workspaceId: "w1", status: "needs_approval", external: true, requiresApproval: true });
    const res = await patch(actionPatch, "a1", { command: "approve" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("approved");
    expect(prisma._db.gmbAction[0].approvedById).toBe("u1");
  });
  it("acción externa NO se aprueba saltándose needs_approval → 409", async () => {
    prisma._db.gmbAction.push({ id: "a1", workspaceId: "w1", status: "suggested", external: true, requiresApproval: true });
    expect((await patch(actionPatch, "a1", { command: "approve" })).status).toBe(409);
  });
  it("EXECUTE de acción interna de contenido → crea borrador GmbPost y done (efecto reversible)", async () => {
    prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1", name: "Café" });
    prisma._db.gmbAction.push({ id: "a1", workspaceId: "w1", clientId: "cl1", module: "content", type: "schedule_posts", title: "Programar", status: "approved", external: false, requiresApproval: false });
    const res = await patch(actionPatch, "a1", { command: "execute" });
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.result.kind).toBe("content_draft");
    expect(prisma._db.gmbPost[0].status).toBe("draft"); // borrador, no publica
  });
});

describe("citations/[id] PATCH — tenant + revalidación NAP", () => {
  it("404 para citación de otro workspace", async () => {
    prisma._db.gmbCitation.push({ id: "c1", workspaceId: "otro", clientId: "cl1", status: "not_found", directorySlug: "yelp-es" });
    expect((await patch(citationPatch, "c1", { command: "detect" })).status).toBe(404);
  });
  it("detect: not_found → pending y registra evento", async () => {
    prisma._db.gmbCitation.push({ id: "c1", workspaceId: "w1", clientId: "cl1", status: "not_found", directorySlug: "yelp-es" });
    const res = await patch(citationPatch, "c1", { command: "detect" });
    expect((await res.json()).status).toBe("pending");
    expect(prisma._db.gmbCitationEvent.length).toBe(1);
  });
  it("revalidación con NAP observado inconsistente → inconsistent + diffs", async () => {
    prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1", name: "Sergisa SL", address: "C/ Calvario 32", phone: "952796658", website: "sergisa.es" });
    prisma._db.gmbCitation.push({ id: "c1", workspaceId: "w1", clientId: "cl1", status: "published", directorySlug: "yelp-es" });
    const res = await patch(citationPatch, "c1", { napObserved: { phone: "666000000" } });
    const body = await res.json();
    expect(body.status).toBe("inconsistent");
    expect(prisma._db.gmbCitation[0].diffs.phone).toBe(true);
  });
});
