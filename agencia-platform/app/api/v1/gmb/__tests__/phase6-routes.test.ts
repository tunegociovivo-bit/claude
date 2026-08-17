/**
 * Fase 6 rutas: alertas (tenant + transición), report-share (crear/revocar) y report público
 * (token inválido/expirado). Prisma y auth mockeados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { hashToken } from "@/lib/gmb/report-share";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const db: any = { gmbAlert: [], gmbClient: [], gmbReportShare: [] };
  const match = (r: any, where: any) => Object.entries(where).every(([k, v]: any) => (v && typeof v === "object" && "in" in v) ? v.in.includes(r[k]) : r[k] === v);
  const coll = (name: string) => ({
    findFirst: vi.fn(async ({ where }: any) => db[name].find((r: any) => match(r, where)) ?? null),
    findUnique: vi.fn(async ({ where }: any) => db[name].find((r: any) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null),
    findMany: vi.fn(async ({ where }: any) => db[name].filter((r: any) => !where || match(r, where))),
    create: vi.fn(async ({ data }: any) => { const r = { id: `${name}${db[name].length + 1}`, ...data }; db[name].push(r); return r; }),
    updateMany: vi.fn(async ({ where, data }: any) => { let n = 0; for (const r of db[name]) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; })
  });
  const p: any = { _db: db };
  for (const n of Object.keys(db)) p[n] = coll(n);
  return { authenticateMock: vi.fn(), prisma: p };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => ({ ...(await importActual() as any), authenticate: authenticateMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { PATCH as alertPatch } from "../alerts/[id]/route";
import { POST as sharePost, DELETE as shareDelete } from "../clients/[id]/report-share/route";
import { GET as publicReport } from "../public/report/[token]/route";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(prisma._db)) prisma._db[k].length = 0;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

describe("alerts/[id] PATCH", () => {
  const patch = (id: string, body: any) => alertPatch(new NextRequest("https://h/x", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: { id } });
  it("404 alerta de otro workspace", async () => {
    prisma._db.gmbAlert.push({ id: "a1", workspaceId: "otro", status: "open" });
    expect((await patch("a1", { command: "ack" })).status).toBe(404);
  });
  it("ack fija actor", async () => {
    prisma._db.gmbAlert.push({ id: "a1", workspaceId: "w1", status: "open" });
    const res = await patch("a1", { command: "ack" });
    expect((await res.json()).status).toBe("ack");
    expect(prisma._db.gmbAlert[0].ackedById).toBe("u1");
  });
  it("transición inválida → 409", async () => {
    prisma._db.gmbAlert.push({ id: "a1", workspaceId: "w1", status: "resolved" });
    expect((await patch("a1", { command: "ack" })).status).toBe(409);
  });
});

describe("report-share crear/revocar", () => {
  it("crea enlace con token (una vez) y guarda solo el hash", async () => {
    prisma._db.gmbClient.push({ id: "cl1", workspaceId: "w1", name: "Café" });
    const res = await sharePost(new NextRequest("https://hub.example/x", { method: "POST", body: JSON.stringify({ expiryDays: 15 }), headers: { "content-type": "application/json" } }), { params: { id: "cl1" } });
    const body = await res.json();
    expect(body.url).toContain("/gmb-report/");
    const token = body.url.split("/gmb-report/")[1];
    expect(prisma._db.gmbReportShare[0].tokenHash).toBe(hashToken(token)); // solo hash guardado
    expect(prisma._db.gmbReportShare[0].tokenHash).not.toBe(token);
    // revocar
    const shareId = prisma._db.gmbReportShare[0].id;
    await shareDelete(new NextRequest(`https://h/x?shareId=${shareId}`, { method: "DELETE" }), { params: { id: "cl1" } });
    expect(prisma._db.gmbReportShare[0].revokedAt).toBeTruthy();
  });
});

describe("report público", () => {
  const get = (token: string) => publicReport(new Request(`https://h/api/v1/gmb/public/report/${token}`), { params: { token } });
  it("token inexistente → 404", async () => {
    expect((await get("nope")).status).toBe(404);
  });
  it("token revocado/expirado → 410", async () => {
    prisma._db.gmbReportShare.push({ id: "s1", workspaceId: "w1", clientId: "cl1", tokenHash: hashToken("tok"), expiresAt: new Date(Date.now() - 1000), includePII: false });
    expect((await get("tok")).status).toBe(410);
  });
});
