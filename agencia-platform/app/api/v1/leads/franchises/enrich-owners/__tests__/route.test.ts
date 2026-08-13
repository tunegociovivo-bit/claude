/**
 * POST /api/v1/leads/franchises/enrich-owners — enriquecimiento de titular de local.
 * Revisión: NO sobrescribe email existente; solo procesa leads brand_locations; idempotente
 * salvo force; tenant-scoped en lectura y escritura.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma, researchMock } = vi.hoisted(() => {
  const rows: any[] = [];
  const prismaObj: any = {
    _rows: rows,
    _updates: [] as any[],
    lead: {
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => r.workspaceId === where.workspaceId && (!where.id?.in || where.id.in.includes(r.id)))),
      updateMany: vi.fn(async ({ where, data }: any) => {
        prismaObj._updates.push({ where, data });
        const r = rows.find((x) => x.id === where.id && x.workspaceId === where.workspaceId);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      })
    }
  };
  return { authenticateMock: vi.fn(), prisma: prismaObj, researchMock: vi.fn() };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => ({ ...(await importActual() as any), authenticate: authenticateMock }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));
vi.mock("@/lib/leads/franchise-owner-enrichment", () => ({ researchFranchiseOwner: researchMock }));

import { POST } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  prisma._rows.length = 0;
  prisma._updates.length = 0;
  researchMock.mockResolvedValue({ classification: "franchise", operatorName: "Local SL", emails: ["owner@local.es"], phones: [], sources: [], confidence: "high" });
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

const call = (body: any) =>
  POST(new NextRequest("https://hub.example/api/v1/leads/franchises/enrich-owners", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: {} });

describe("enrich-owners", () => {
  it("NO sobrescribe un email ya existente", async () => {
    prisma._rows.push({ id: "l1", workspaceId: "w1", name: "Alcampo X", email: "ya@existe.com", rawData: { source: "brand_locations", brand: "Alcampo" } });
    const res = await call({ ids: ["l1"], force: true });
    expect(res.status).toBe(200);
    const upd = prisma._updates[0];
    expect("email" in upd.data).toBe(false); // no se toca el email
    expect(prisma._rows[0].email).toBe("ya@existe.com");
    expect(upd.data.rawData.franchiseOwner).toBeTruthy(); // sí guarda la investigación
  });
  it("rellena el email SOLO si el lead no tenía", async () => {
    prisma._rows.push({ id: "l2", workspaceId: "w1", name: "Alcampo Y", email: null, rawData: { source: "brand_locations" } });
    await call({ ids: ["l2"], force: true });
    expect(prisma._rows[0].email).toBe("owner@local.es");
  });
  it("solo procesa leads brand_locations", async () => {
    prisma._rows.push({ id: "l3", workspaceId: "w1", name: "Normal", email: null, rawData: { source: "places" } });
    const res = await call({ ids: ["l3"], force: true });
    expect((await res.json()).enriched).toBe(0);
    expect(researchMock).not.toHaveBeenCalled();
  });
  it("idempotente: ya enriquecido sin force → se salta", async () => {
    prisma._rows.push({ id: "l4", workspaceId: "w1", name: "Alcampo Z", email: null, rawData: { source: "brand_locations", franchiseOwner: { classification: "franchise" } } });
    const res = await call({ ids: ["l4"] });
    expect((await res.json()).enriched).toBe(0);
    expect(researchMock).not.toHaveBeenCalled();
  });
  it("escritura tenant-scoped (workspaceId en el where del updateMany)", async () => {
    prisma._rows.push({ id: "l5", workspaceId: "w1", name: "Alcampo", email: null, rawData: { source: "brand_locations" } });
    await call({ ids: ["l5"], force: true });
    expect(prisma._updates[0].where.workspaceId).toBe("w1");
  });
  it("sin target (ni searchId ni ids) → 400", async () => {
    expect((await call({})).status).toBe(400);
  });
});
