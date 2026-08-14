/**
 * Cola de FASE 2 (contacto). Encolar es rápido y NO llama a proveedores; solo sobre titulares
 * IDENTIFICADOS (owner done_data). El proceso persiste `franchiseOwner.contact` sin tocar la fase 1,
 * rellena el email del lead solo si estaba vacío y NO sobrescribe email existente. Tenant-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("../franchise-contact-enrichment", () => ({ researchFranchiseContact: researchMock }));

import { queueFranchiseContactResearch, processFranchiseContactQueue } from "../franchise-contact-queue";

function mkPrisma(rows: any[]) {
  const get = (obj: any, path: string[]) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const matches = (r: any, where: any) => {
    if (r.workspaceId !== where.workspaceId) return false;
    if (where.searchId && r.searchId !== where.searchId) return false;
    if (where.id?.in && !where.id.in.includes(r.id)) return false;
    if (where.rawData?.path) {
      if (get(r.rawData, where.rawData.path) !== where.rawData.equals) return false;
    }
    return true;
  };
  return {
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
}

const identified = (over: any = {}) => ({ status: "done", operatorName: "SERGISA SL", taxId: "B93378453", ownerName: "Sergio", operatorWebsite: "sergisa.es", ...over });

beforeEach(() => vi.clearAllMocks());

describe("queueFranchiseContactResearch — elegibilidad", () => {
  it("solo encola titulares IDENTIFICADOS; cuenta los no identificados", async () => {
    const rows = [
      { id: "a", workspaceId: "w1", searchId: "s1", rawData: { franchiseOwner: identified() } }, // done_data → encola
      { id: "b", workspaceId: "w1", searchId: "s1", rawData: { franchiseOwner: { status: "done" } } }, // done_empty → no
      { id: "c", workspaceId: "w1", searchId: "s1", rawData: {} } // none → no
    ];
    const p = mkPrisma(rows);
    const out = await queueFranchiseContactResearch(p as any, "w1", { searchId: "s1" });
    expect(out.queued).toBe(1);
    expect(out.skippedReasons.notIdentified).toBe(2);
    expect(rows[0].rawData.franchiseOwner.contact.status).toBe("queued");
    expect(rows[0].rawData.franchiseOwner.contact.attempts).toBe(0);
    // Conserva la fase 1.
    expect(rows[0].rawData.franchiseOwner.operatorName).toBe("SERGISA SL");
  });

  it("salta los ya contactables y los que están en cola", async () => {
    const rows = [
      { id: "a", workspaceId: "w1", searchId: "s1", rawData: { franchiseOwner: identified({ contact: { status: "actionable_contact" } }) } },
      { id: "b", workspaceId: "w1", searchId: "s1", rawData: { franchiseOwner: identified({ contact: { status: "queued" } }) } }
    ];
    const out = await queueFranchiseContactResearch(mkPrisma(rows) as any, "w1", { searchId: "s1" });
    expect(out.queued).toBe(0);
    expect(out.skippedReasons.alreadyContactable).toBe(1);
    expect(out.skippedReasons.running).toBe(1);
  });

  it("tenant: no encola leads de otro workspace", async () => {
    const rows = [{ id: "a", workspaceId: "otro", searchId: "s1", rawData: { franchiseOwner: identified() } }];
    const out = await queueFranchiseContactResearch(mkPrisma(rows) as any, "w1", { searchId: "s1" });
    expect(out.queued).toBe(0);
    expect(out.scanned).toBe(0);
  });
});

describe("processFranchiseContactQueue", () => {
  it("procesa la cola, persiste contact y rellena email vacío con el accionable", async () => {
    researchMock.mockResolvedValue({
      status: "actionable_contact",
      channels: [{ type: "email", value: "info@sergisa.es", source: "web_oficial", confidence: "high", verified: null, person: null, role: null, sourceUrl: "https://sergisa.es", foundAt: "2026-08-14T12:00:00.000Z" }],
      providersTried: ["web_oficial"], explanation: "ok", researchedAt: "2026-08-14T12:00:00.000Z"
    });
    const rows = [{ id: "a", workspaceId: "w1", name: "Eroski", phone: "952796658", email: null, website: "eroski.es", rawData: { franchiseOwner: identified({ contact: { status: "queued", attempts: 0 } }) } }];
    const p = mkPrisma(rows);
    const out = await processFranchiseContactQueue(p as any, "w1", { max: 5 });
    expect(out.processed).toBe(1);
    expect(rows[0].rawData.franchiseOwner.contact.status).toBe("actionable_contact");
    expect(rows[0].email).toBe("info@sergisa.es"); // rellena porque estaba vacío
    expect(rows[0].rawData.franchiseOwner.operatorName).toBe("SERGISA SL"); // no toca la fase 1
  });

  it("NO sobrescribe un email existente", async () => {
    researchMock.mockResolvedValue({
      status: "actionable_contact",
      channels: [{ type: "email", value: "nuevo@sergisa.es", source: "web_oficial", confidence: "high", verified: null, person: null, role: null, sourceUrl: null, foundAt: "x" }],
      providersTried: ["web_oficial"], explanation: "ok", researchedAt: "x"
    });
    const rows = [{ id: "a", workspaceId: "w1", name: "X", phone: null, email: "previo@x.es", website: null, rawData: { franchiseOwner: identified({ contact: { status: "queued", attempts: 0 } }) } }];
    await processFranchiseContactQueue(mkPrisma(rows) as any, "w1", { max: 5 });
    expect(rows[0].email).toBe("previo@x.es"); // intacto
  });

  it("aísla errores por lead: reintenta y agota a provider_error", async () => {
    researchMock.mockRejectedValue(new Error("boom"));
    const rows = [{ id: "a", workspaceId: "w1", name: "X", phone: null, email: null, website: null, rawData: { franchiseOwner: identified({ contact: { status: "queued", attempts: 1 } }) } }];
    await processFranchiseContactQueue(mkPrisma(rows) as any, "w1", { max: 5 });
    expect(rows[0].rawData.franchiseOwner.contact.status).toBe("provider_error");
    expect(rows[0].rawData.franchiseOwner.contact.lastError).toContain("boom");
  });
});
