/**
 * FASE 2 — contacto profesional del titular. Con proveedores MOCKEADOS (nunca se contacta a un
 * negocio real). Demuestra: email publicado en web oficial o verificado = accionable; el fijo de
 * Google Places NO cuenta como canal nuevo; sin medios → provider_error; sin titular → unconfirmed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { keys, extractMock, companyMock, domainMock, apolloMock, finderMock, verifyMock } = vi.hoisted(() => ({
  keys: { apolloKey: null as string | null, hunterKey: null as string | null },
  extractMock: vi.fn(async () => ({ emails: [] as string[], mobiles: [] as string[] })),
  companyMock: vi.fn(async () => ({ domain: null as string | null, people: [] as any[] })),
  domainMock: vi.fn(async () => [] as any[]),
  apolloMock: vi.fn(async () => [] as any[]),
  finderMock: vi.fn(async () => null as any),
  verifyMock: vi.fn(async () => null as any)
}));

vi.mock("../enrich-contacts", () => ({
  resolveContactKeys: vi.fn(async () => keys),
  hunterCompanySearch: companyMock,
  hunterDomainSearch: domainMock,
  apolloFindDecisionMakers: apolloMock,
  hunterFindEmail: finderMock,
  hunterVerifyEmail: verifyMock
}));
// email-extract: mockeamos SOLO el crawler; normalizeEsPhone se mantiene real.
vi.mock("../email-extract", async (importActual) => ({ ...(await importActual() as any), extractContactsFromWebsite: extractMock }));

import { researchFranchiseContact } from "../franchise-contact-enrichment";

beforeEach(() => {
  vi.clearAllMocks();
  keys.apolloKey = null; keys.hunterKey = null;
  extractMock.mockResolvedValue({ emails: [], mobiles: [] });
  companyMock.mockResolvedValue({ domain: null, people: [] });
  domainMock.mockResolvedValue([]);
  apolloMock.mockResolvedValue([]);
  finderMock.mockResolvedValue(null);
  verifyMock.mockResolvedValue(null);
});

const base = { workspaceId: "w1", operatorName: "ALIMENTACION SERGISA SL", taxId: "B93378453", adminName: "Sergio García", now: new Date("2026-08-14T12:00:00Z") };

describe("researchFranchiseContact", () => {
  it("email + móvil PUBLICADOS en la web oficial → actionable_contact", async () => {
    extractMock.mockResolvedValue({ emails: ["info@sergisa.es"], mobiles: ["666123456"] });
    const r = await researchFranchiseContact({ ...base, operatorWebsite: "sergisa.es", existingPhone: "952796658", existingEmail: null });
    expect(r.status).toBe("actionable_contact");
    const email = r.channels.find((c) => c.type === "email")!;
    expect(email.value).toBe("info@sergisa.es");
    expect(email.source).toBe("web_oficial");
    expect(email.confidence).toBe("high");
    expect(email.foundAt).toBe("2026-08-14T12:00:00.000Z");
    expect(r.channels.some((c) => c.type === "mobile" && c.value === "666123456")).toBe(true);
    expect(r.providersTried).toContain("web_oficial");
  });

  it("el FIJO de Google Places NO cuenta como móvil nuevo", async () => {
    // La web publica solo el mismo fijo que ya venía de Places (no es móvil) → nada accionable.
    extractMock.mockResolvedValue({ emails: [], mobiles: [] });
    const r = await researchFranchiseContact({ ...base, operatorWebsite: "sergisa.es", existingPhone: "952796658", existingEmail: null });
    expect(r.status).toBe("identified_no_contact");
    expect(r.channels).toHaveLength(0);
  });

  it("email de Hunter VERIFICADO entregable → actionable_contact", async () => {
    keys.hunterKey = "hk";
    companyMock.mockResolvedValue({ domain: "sergisa.es", people: [{ name: "Sergio García", position: "Administrador", email: "sergio@sergisa.es", confidence: 88 }] });
    verifyMock.mockResolvedValue({ email: "sergio@sergisa.es", status: "valid", score: 96 });
    const r = await researchFranchiseContact({ ...base, operatorWebsite: null, existingPhone: "952796658", existingEmail: null });
    expect(r.status).toBe("actionable_contact");
    const email = r.channels.find((c) => c.type === "email")!;
    expect(email.value).toBe("sergio@sergisa.es");
    expect(email.verified).toMatchObject({ status: "valid" });
    expect(email.person).toBe("Sergio García");
    expect(r.providersTried).toContain("hunter");
  });

  it("email de proveedor SIN verificar entregable → identified_no_contact (no se inventa)", async () => {
    keys.hunterKey = "hk";
    companyMock.mockResolvedValue({ domain: "sergisa.es", people: [{ name: "X", position: null, email: "x@sergisa.es", confidence: 40 }] });
    verifyMock.mockResolvedValue({ email: "x@sergisa.es", status: "invalid", score: 5 });
    const r = await researchFranchiseContact({ ...base, operatorWebsite: null, existingPhone: null, existingEmail: null });
    expect(r.status).toBe("identified_no_contact");
    // El candidato se guarda pero NO como accionable.
    expect(r.channels.find((c) => c.value === "x@sergisa.es")?.verified?.status).toBe("invalid");
  });

  it("sin web local ni integraciones → provider_error (config incompleta, visible)", async () => {
    const r = await researchFranchiseContact({ ...base, operatorWebsite: null, existingPhone: null, existingEmail: null });
    expect(r.status).toBe("provider_error");
    expect(r.explanation).toMatch(/integraciones|web/i);
  });

  it("sin titular confirmado → unconfirmed (no busca)", async () => {
    const r = await researchFranchiseContact({ workspaceId: "w1", operatorName: null, operatorWebsite: "x.es" });
    expect(r.status).toBe("unconfirmed");
    expect(r.channels).toHaveLength(0);
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("no repite el email que ya tenía el lead (no es canal nuevo)", async () => {
    extractMock.mockResolvedValue({ emails: ["ya@sergisa.es"], mobiles: [] });
    const r = await researchFranchiseContact({ ...base, operatorWebsite: "sergisa.es", existingPhone: null, existingEmail: "ya@sergisa.es" });
    expect(r.status).toBe("identified_no_contact");
  });
});
