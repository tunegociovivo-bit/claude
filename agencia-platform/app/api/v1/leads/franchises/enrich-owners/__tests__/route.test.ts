/**
 * POST /api/v1/leads/franchises/enrich-owners — ARREGLO DEL 502: ahora solo ENCOLA y
 * devuelve rápido (no investiga en la request → no puede exceder el timeout del proxy).
 * GET devuelve progreso. Tenant-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma, researchMock } = vi.hoisted(() => {
  const rows: any[] = [];
  const foStatus = (r: any) => r.rawData?.franchiseOwner?.status ?? null;
  const matches = (r: any, where: any) => {
    if (r.workspaceId !== where.workspaceId) return false;
    if (where.searchId && r.searchId !== where.searchId) return false;
    if (where.id?.in && !where.id.in.includes(r.id)) return false;
    if (where.rawData?.path) {
      const [k, sub] = where.rawData.path;
      const val = k === "franchiseOwner" && sub === "status" ? foStatus(r) : undefined;
      if (val !== where.rawData.equals) return false;
    }
    return true;
  };
  const prismaObj: any = {
    _rows: rows,
    lead: {
      findMany: vi.fn(async ({ where, take }: any) => rows.filter((r) => matches(r, where)).slice(0, take ?? rows.length).map((r) => ({ ...r }))),
      count: vi.fn(async ({ where }: any) => rows.filter((r) => matches(r, where)).length),
      updateMany: vi.fn(async ({ where, data }: any) => {
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
// La investigación (lenta) NO debe llamarse desde la request.
vi.mock("@/lib/leads/franchise-owner-enrichment", () => ({ researchFranchiseOwner: researchMock }));

import { POST, GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  prisma._rows.length = 0;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

const post = (body: any) => POST(new NextRequest("https://hub.example/api/v1/leads/franchises/enrich-owners", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: {} });
const get = (qs: string) => GET(new NextRequest(`https://hub.example/api/v1/leads/franchises/enrich-owners?${qs}`), { params: {} });

describe("POST enqueue-fast (no 502)", () => {
  it("encola brand_locations y NO investiga en la request", async () => {
    prisma._rows.push({ id: "l1", workspaceId: "w1", rawData: { source: "brand_locations" } });
    const res = await post({ ids: ["l1"] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, queued: 1 });
    expect(researchMock).not.toHaveBeenCalled(); // clave: sin trabajo síncrono → no timeout/502
    expect(prisma._rows[0].rawData.franchiseOwner.status).toBe("queued");
  });
  it("sin target → 400", async () => {
    expect((await post({})).status).toBe(400);
  });
  it("tenant: no encola leads de otro workspace", async () => {
    prisma._rows.push({ id: "l1", workspaceId: "otro", rawData: { source: "brand_locations" } });
    const res = await post({ ids: ["l1"] });
    expect((await res.json()).queued).toBe(0);
    expect(prisma._rows[0].rawData.franchiseOwner).toBeUndefined();
  });
});

describe("GET progreso/estado", () => {
  it("?searchId= → cuenta queued/done/error", async () => {
    prisma._rows.push({ id: "a", workspaceId: "w1", searchId: "s1", rawData: { franchiseOwner: { status: "queued" } } });
    const body = await (await get("searchId=s1")).json();
    expect(body.progress).toMatchObject({ queued: 1, done: 0, error: 0 });
  });
  it("?ids= → estado por lead", async () => {
    prisma._rows.push({ id: "l1", workspaceId: "w1", name: "X", rawData: { franchiseOwner: { status: "done", operatorName: "Local SL" } } });
    const body = await (await get("ids=l1")).json();
    expect(body.items[0]).toMatchObject({ id: "l1", franchiseOwner: { status: "done", operatorName: "Local SL" } });
  });
});
