/**
 * Cola async de titulares de franquicia (arreglo del 502): encolar es rápido y NO investiga;
 * el procesado es por-lead con aislamiento de errores, reintentos acotados, idempotencia y
 * sin sobrescribir email existente. Tenant-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("../franchise-owner-enrichment", () => ({ researchFranchiseOwner: researchMock }));

import { queueFranchiseOwnerResearch, processFranchiseOwnerQueue, franchiseOwnerProgress, MAX_OWNER_ATTEMPTS } from "../franchise-owner-queue";

/** Prisma mock que entiende el filtro JSON `rawData.path=[franchiseOwner,status] equals`. */
function mkPrisma(rows: any[]) {
  const foStatus = (r: any) => r.rawData?.franchiseOwner?.status ?? null;
  const matches = (r: any, where: any) => {
    if (r.workspaceId !== where.workspaceId) return false;
    if (where.searchId && r.searchId !== where.searchId) return false;
    if (where.id?.in && !where.id.in.includes(r.id)) return false;
    if (where.rawData?.path) {
      const [k, sub] = where.rawData.path;
      const val = k === "franchiseOwner" && sub === "status" ? foStatus(r) : k === "source" ? r.rawData?.source : undefined;
      if (val !== where.rawData.equals) return false;
    }
    return true;
  };
  return {
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
}

const NOW = new Date("2026-08-13T12:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  researchMock.mockResolvedValue({ classification: "franchise", operatorName: "Local SL", emails: ["owner@local.es"], phones: [], sources: [], confidence: "high" });
});

describe("queueFranchiseOwnerResearch — rápido, no investiga", () => {
  it("marca brand_locations como queued y NO llama al modelo", async () => {
    const p = mkPrisma([
      { id: "l1", workspaceId: "w1", rawData: { source: "brand_locations" } },
      { id: "l2", workspaceId: "w1", rawData: { source: "places" } } // no brand → skip
    ]);
    const out = await queueFranchiseOwnerResearch(p as any, "w1", { ids: ["l1", "l2"], now: NOW });
    expect(out).toMatchObject({ queued: 1, skipped: 1 });
    expect(p._rows[0].rawData.franchiseOwner.status).toBe("queued");
    expect(researchMock).not.toHaveBeenCalled(); // clave: encolar NO investiga → no 502
  });
  it("idempotente: no re-encola lo ya en cola / hecho salvo force", async () => {
    const p = mkPrisma([{ id: "l1", workspaceId: "w1", rawData: { source: "brand_locations", franchiseOwner: { status: "done" } } }]);
    expect((await queueFranchiseOwnerResearch(p as any, "w1", { ids: ["l1"] })).queued).toBe(0);
    expect((await queueFranchiseOwnerResearch(p as any, "w1", { ids: ["l1"], force: true })).queued).toBe(1);
  });
});

describe("processFranchiseOwnerQueue — por lote, aislado, con reintentos", () => {
  it("procesa un queued → done y rellena email SOLO si estaba vacío", async () => {
    const p = mkPrisma([{ id: "l1", workspaceId: "w1", name: "Eroski X", email: null, rawData: { source: "brand_locations", franchiseOwner: { status: "queued", attempts: 0 } } }]);
    const out = await processFranchiseOwnerQueue(p as any, "w1", { now: NOW });
    expect(out).toMatchObject({ processed: 1, errored: 0 });
    expect(p._rows[0].rawData.franchiseOwner.status).toBe("done");
    expect(p._rows[0].email).toBe("owner@local.es");
  });
  it("NO sobrescribe un email existente", async () => {
    const p = mkPrisma([{ id: "l1", workspaceId: "w1", name: "Eroski", email: "ya@existe.com", rawData: { source: "brand_locations", franchiseOwner: { status: "queued", attempts: 0 } } }]);
    await processFranchiseOwnerQueue(p as any, "w1", { now: NOW });
    expect(p._rows[0].email).toBe("ya@existe.com");
  });
  it("error POR LEAD: un fallo reintenta y NO tumba el resto", async () => {
    researchMock.mockImplementationOnce(async () => { throw new Error("boom"); }).mockResolvedValue({ classification: "corporate", emails: [], phones: [], sources: [] });
    const p = mkPrisma([
      { id: "l1", workspaceId: "w1", name: "A", email: null, rawData: { source: "brand_locations", franchiseOwner: { status: "queued", attempts: 0 } } },
      { id: "l2", workspaceId: "w1", name: "B", email: null, rawData: { source: "brand_locations", franchiseOwner: { status: "queued", attempts: 0 } } }
    ]);
    const out = await processFranchiseOwnerQueue(p as any, "w1", { max: 2, now: NOW });
    expect(out).toMatchObject({ processed: 1, errored: 1 });
    expect(p._rows[0].rawData.franchiseOwner.status).toBe("queued"); // reintento (attempt 1 < MAX)
    expect(p._rows[0].rawData.franchiseOwner.attempts).toBe(1);
    expect(p._rows[1].rawData.franchiseOwner.status).toBe("done"); // el otro sí se procesó
  });
  it("reintentos ACOTADOS: al agotar MAX → error terminal", async () => {
    researchMock.mockRejectedValue(new Error("down"));
    const p = mkPrisma([{ id: "l1", workspaceId: "w1", name: "A", email: null, rawData: { source: "brand_locations", franchiseOwner: { status: "queued", attempts: MAX_OWNER_ATTEMPTS - 1 } } }]);
    await processFranchiseOwnerQueue(p as any, "w1", { now: NOW });
    expect(p._rows[0].rawData.franchiseOwner.status).toBe("error");
    expect(p._rows[0].rawData.franchiseOwner.attempts).toBe(MAX_OWNER_ATTEMPTS);
  });
});

describe("franchiseOwnerProgress", () => {
  it("cuenta queued/done/error del workspace", async () => {
    const p = mkPrisma([
      { id: "a", workspaceId: "w1", rawData: { franchiseOwner: { status: "queued" } } },
      { id: "b", workspaceId: "w1", rawData: { franchiseOwner: { status: "done" } } },
      { id: "c", workspaceId: "w1", rawData: { franchiseOwner: { status: "error" } } },
      { id: "d", workspaceId: "other", rawData: { franchiseOwner: { status: "queued" } } } // otro tenant
    ]);
    expect(await franchiseOwnerProgress(p as any, "w1")).toEqual({ queued: 1, done: 1, error: 1 });
  });
});
