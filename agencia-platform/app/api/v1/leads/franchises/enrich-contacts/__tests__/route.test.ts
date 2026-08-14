/**
 * POST /api/v1/leads/franchises/enrich-contacts — ENCOLA la fase de contacto (no llama a
 * proveedores en la request). GET progreso/diag. Tenant-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma, researchMock } = vi.hoisted(() => {
  const rows: any[] = [];
  const get = (obj: any, path: string[]) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const matches = (r: any, where: any) => {
    if (r.workspaceId !== where.workspaceId) return false;
    if (where.searchId && r.searchId !== where.searchId) return false;
    if (where.id?.in && !where.id.in.includes(r.id)) return false;
    if (where.rawData?.path && get(r.rawData, where.rawData.path) !== where.rawData.equals) return false;
    return true;
  };
  const prismaObj: any = {
    _rows: rows,
    lead: {
      findMany: vi.fn(async ({ where, take }: any) => rows.filter((r) => matches(r, where)).slice(0, take ?? rows.length).map((r) => ({ ...r }))),
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
// La búsqueda real de contacto NO debe llamarse desde la request.
vi.mock("@/lib/leads/franchise-contact-enrichment", () => ({ researchFranchiseContact: researchMock }));

import { POST, GET } from "../route";

const identified = { status: "done", operatorName: "SERGISA SL", operatorWebsite: "sergisa.es" };

beforeEach(() => {
  vi.clearAllMocks();
  prisma._rows.length = 0;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

const post = (body: any) => POST(new NextRequest("https://hub.example/api/v1/leads/franchises/enrich-contacts", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: {} });
const get = (qs: string) => GET(new NextRequest(`https://hub.example/api/v1/leads/franchises/enrich-contacts?${qs}`), { params: {} });

describe("POST enqueue-fast", () => {
  it("encola un titular identificado y NO busca en la request", async () => {
    prisma._rows.push({ id: "l1", workspaceId: "w1", searchId: "s1", rawData: { franchiseOwner: identified } });
    const res = await post({ ids: ["l1"] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queued).toBe(1);
    expect(researchMock).not.toHaveBeenCalled();
    expect(prisma._rows[0].rawData.franchiseOwner.contact.status).toBe("queued");
  });
  it("sin target → 400", async () => {
    expect((await post({})).status).toBe(400);
  });
  it("no identificado → queued 0 con motivo", async () => {
    prisma._rows.push({ id: "l1", workspaceId: "w1", searchId: "s1", rawData: { franchiseOwner: { status: "done" } } });
    const body = await (await post({ ids: ["l1"] })).json();
    expect(body.queued).toBe(0);
    expect(body.skippedReasons.notIdentified).toBe(1);
  });
  it("tenant: no encola de otro workspace", async () => {
    prisma._rows.push({ id: "l1", workspaceId: "otro", searchId: "s1", rawData: { franchiseOwner: identified } });
    const body = await (await post({ ids: ["l1"] })).json();
    expect(body.queued).toBe(0);
  });
});

describe("GET progreso/diag", () => {
  it("?searchId= → cuenta identificados/contactables", async () => {
    prisma._rows.push({ id: "a", workspaceId: "w1", searchId: "s1", rawData: { franchiseOwner: { ...identified, contact: { status: "actionable_contact", channels: [{ type: "email", value: "x@y.es" }] } } } });
    const body = await (await get("searchId=s1")).json();
    expect(body.progress).toMatchObject({ identified: 1, contactable: 1 });
  });
  it("?diag=1 → desglose por estado de contacto", async () => {
    prisma._rows.push({ id: "a", workspaceId: "w1", searchId: "s1", rawData: { franchiseOwner: { ...identified, contact: { status: "identified_no_contact", channels: [] } } } });
    const body = await (await get("diag=1&searchId=s1")).json();
    expect(body.diag.byStatus.identified_no_contact).toBe(1);
  });
});
