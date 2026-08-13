/**
 * Cola async de titulares de franquicia (arreglo del 502): encolar es rápido y NO investiga;
 * el procesado es por-lead con aislamiento de errores, reintentos acotados, idempotencia y
 * sin sobrescribir email existente. Tenant-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("../franchise-owner-enrichment", () => ({ researchFranchiseOwner: researchMock }));

import { queueFranchiseOwnerResearch, processFranchiseOwnerQueue, franchiseOwnerProgress, franchiseOwnerDiag, classifyOwnerState, ownerHasEvidence, MAX_OWNER_ATTEMPTS } from "../franchise-owner-queue";

/** Prisma mock que entiende el filtro JSON `rawData.path=[franchiseOwner,status] equals`. */
function mkPrisma(rows: any[], searches: any[] = []) {
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
    },
    leadSearch: {
      findMany: vi.fn(async ({ where }: any) => searches.filter((s) => s.workspaceId === where.workspaceId && (!where.id?.in || where.id.in.includes(s.id))).map((s) => ({ id: s.id, keyword: s.keyword })))
    }
  };
}

const NOW = new Date("2026-08-13T12:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  researchMock.mockResolvedValue({ classification: "franchise", operatorName: "Local SL", emails: ["owner@local.es"], phones: [], sources: [], confidence: "high" });
});

describe("queueFranchiseOwnerResearch — objetivo explícito, incluye leads NORMALES", () => {
  it("encola TODOS los leads de una búsqueda concreta (aunque no sean brand_locations) con marca=keyword; no investiga", async () => {
    const p = mkPrisma(
      [
        { id: "l1", workspaceId: "w1", searchId: "s1", rawData: { source: "places" } }, // lead NORMAL
        { id: "l2", workspaceId: "w1", searchId: "s1", rawData: { source: "brand_locations", brand: "Eroski" } }
      ],
      [{ id: "s1", workspaceId: "w1", keyword: "Eroski" }]
    );
    const out = await queueFranchiseOwnerResearch(p as any, "w1", { searchId: "s1", now: NOW });
    expect(out).toMatchObject({ queued: 2, skipped: 0, scanned: 2 });
    expect(p._rows[0].rawData.franchiseOwner).toMatchObject({ status: "queued", brand: "Eroski" }); // marca = keyword de la búsqueda
    expect(researchMock).not.toHaveBeenCalled();
  });
  it("SCOPING: no toca leads de otra búsqueda ni de otro workspace", async () => {
    const p = mkPrisma(
      [
        { id: "a", workspaceId: "w1", searchId: "s1", rawData: { source: "places" } },
        { id: "b", workspaceId: "w1", searchId: "s2", rawData: { source: "places" } }, // otra búsqueda
        { id: "c", workspaceId: "other", searchId: "s1", rawData: { source: "places" } } // otro workspace
      ],
      [{ id: "s1", workspaceId: "w1", keyword: "Eroski" }]
    );
    const out = await queueFranchiseOwnerResearch(p as any, "w1", { searchId: "s1", now: NOW });
    expect(out.queued).toBe(1);
    expect(p._rows[0].rawData.franchiseOwner?.status).toBe("queued"); // a
    expect(p._rows[1].rawData.franchiseOwner).toBeUndefined(); // b (otra búsqueda) intacto
    expect(p._rows[2].rawData.franchiseOwner).toBeUndefined(); // c (otro workspace) intacto
  });
  it("no re-encola un 'done' CON datos reales; sí un force", async () => {
    const withData = { status: "done", operatorName: "Local SL", emails: ["x@local.es"] };
    const p = mkPrisma([{ id: "l1", workspaceId: "w1", searchId: "s1", rawData: { source: "places", franchiseOwner: withData } }], [{ id: "s1", workspaceId: "w1", keyword: "Eroski" }]);
    const out = await queueFranchiseOwnerResearch(p as any, "w1", { ids: ["l1"] });
    expect(out.queued).toBe(0);
    expect(out.skippedReasons.alreadyEnriched).toBe(1);
    expect((await queueFranchiseOwnerResearch(p as any, "w1", { ids: ["l1"], force: true })).queued).toBe(1);
  });
});

describe("compatibilidad de estados históricos: 'done' VACÍO = stale-empty (reencolable)", () => {
  it("clasifica done sin evidencia como done_empty y CON evidencia como done_data", () => {
    expect(classifyOwnerState({ status: "done" })).toBe("done_empty");
    expect(classifyOwnerState({ status: "done", classification: "unconfirmed", emails: [] })).toBe("done_empty");
    expect(classifyOwnerState({ status: "done", operatorName: "X SL" })).toBe("done_data");
    expect(classifyOwnerState({ status: "done", emails: ["a@b.c"] })).toBe("done_data");
    expect(classifyOwnerState({ status: "error" })).toBe("error");
    expect(classifyOwnerState(undefined)).toBe("none");
    expect(ownerHasEvidence({ taxId: "B123" })).toBe(true);
    expect(ownerHasEvidence({ classification: "unconfirmed" })).toBe(false);
  });
  it("clic explícito REENCOLA los 'done' vacíos (los 5 Eroski) con intentos reiniciados, sin tocar los que tienen datos", async () => {
    const p = mkPrisma(
      [
        { id: "empty1", workspaceId: "w1", searchId: "s1", rawData: { source: "places", franchiseOwner: { status: "done", attempts: 1, classification: "unconfirmed" } } },
        { id: "data1", workspaceId: "w1", searchId: "s1", rawData: { source: "places", franchiseOwner: { status: "done", operatorName: "Real SL" } } }
      ],
      [{ id: "s1", workspaceId: "w1", keyword: "Eroski" }]
    );
    const out = await queueFranchiseOwnerResearch(p as any, "w1", { searchId: "s1", now: NOW });
    expect(out.queued).toBe(1); // solo el vacío
    expect(out.skippedReasons.alreadyEnriched).toBe(1); // el que tiene datos NO se toca
    expect(p._rows[0].rawData.franchiseOwner).toMatchObject({ status: "queued", attempts: 0 }); // reencolado, intentos reiniciados
    expect(p._rows[1].rawData.franchiseOwner.status).toBe("done"); // intacto
  });
  it("retryEmpty reencola done_empty + error, no los done_data", async () => {
    const p = mkPrisma(
      [
        { id: "e", workspaceId: "w1", searchId: "s1", rawData: { source: "places", franchiseOwner: { status: "done" } } },
        { id: "err", workspaceId: "w1", searchId: "s1", rawData: { source: "places", franchiseOwner: { status: "error", attempts: 2 } } },
        { id: "d", workspaceId: "w1", searchId: "s1", rawData: { source: "places", franchiseOwner: { status: "done", taxId: "B9" } } }
      ],
      [{ id: "s1", workspaceId: "w1", keyword: "Eroski" }]
    );
    const out = await queueFranchiseOwnerResearch(p as any, "w1", { searchId: "s1", retryEmpty: true, now: NOW });
    expect(out.queued).toBe(2);
    expect(out.skippedReasons.alreadyEnriched).toBe(1);
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

describe("retryErrors — re-encola SOLO los fallidos", () => {
  it("re-encola status=error, ignora done/queued", async () => {
    const p = mkPrisma([
      { id: "e1", workspaceId: "w1", rawData: { source: "brand_locations", franchiseOwner: { status: "error", attempts: 2 } } },
      { id: "d1", workspaceId: "w1", rawData: { source: "brand_locations", franchiseOwner: { status: "done" } } }
    ]);
    const out = await queueFranchiseOwnerResearch(p as any, "w1", { ids: ["e1", "d1"], retryErrors: true });
    expect(out.queued).toBe(1);
    expect(p._rows[0].rawData.franchiseOwner.status).toBe("queued");
    expect(p._rows[0].rawData.franchiseOwner.attempts).toBe(0); // reinicia intentos
    expect(p._rows[1].rawData.franchiseOwner.status).toBe("done"); // el hecho no se toca
  });
  it("scanned=0 cuando la búsqueda no tiene leads (motivo claro, no silencio)", async () => {
    const p = mkPrisma([], []);
    const out = await queueFranchiseOwnerResearch(p as any, "w1", { searchId: "vacia" });
    expect(out).toMatchObject({ queued: 0, scanned: 0 });
  });
});

describe("franchiseOwnerDiag — estado real por búsqueda", () => {
  it("desglosa por estado e incluye motivo de error", async () => {
    const p = mkPrisma([
      { id: "a", workspaceId: "w1", searchId: "s1", email: null, rawData: { source: "brand_locations", franchiseOwner: { status: "error", lastError: "web_search_unavailable" } } },
      { id: "b", workspaceId: "w1", searchId: "s1", email: null, rawData: { source: "brand_locations" } } // sin franchiseOwner → none
    ]);
    const diag = await franchiseOwnerDiag(p as any, "w1", "s1");
    expect(diag.total).toBe(2);
    expect(diag.byStatus).toMatchObject({ error: 1, none: 1 });
    expect(diag.sample.find((s: any) => s.id === "a").lastError).toBe("web_search_unavailable");
  });
});

describe("franchiseOwnerProgress", () => {
  it("cuenta queued/done/error del workspace", async () => {
    const p = mkPrisma([
      { id: "a", workspaceId: "w1", rawData: { franchiseOwner: { status: "queued" } } },
      { id: "b", workspaceId: "w1", rawData: { franchiseOwner: { status: "done", operatorName: "Local SL" } } }, // con datos
      { id: "e", workspaceId: "w1", rawData: { franchiseOwner: { status: "done" } } }, // hecho SIN datos (stale-empty)
      { id: "c", workspaceId: "w1", rawData: { franchiseOwner: { status: "error" } } },
      { id: "d", workspaceId: "other", rawData: { franchiseOwner: { status: "queued" } } } // otro tenant
    ]);
    expect(await franchiseOwnerProgress(p as any, "w1")).toEqual({ queued: 1, done: 1, doneEmpty: 1, error: 1 });
  });
});
