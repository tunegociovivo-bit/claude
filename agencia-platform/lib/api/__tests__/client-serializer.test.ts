/**
 * Parche de seguridad — allowlist de GET /clients/[id]. Verifica que ningún
 * campo sensible se filtra a no-admin y que stripe/meta no salen para NADIE.
 */
import { describe, it, expect } from "vitest";
import { serializeClient, CLIENT_ADMIN_FIELDS, CLIENT_NEVER_FIELDS } from "../client-serializer";

// Cliente con TODOS los campos poblados (incl. sensibles) para probar la fuga.
const FULL: Record<string, any> = {
  id: "c1",
  workspaceId: "w1",
  name: "Bar Pepe",
  industry: "Hostelería",
  status: "ACTIVE",
  contactName: "Ana",
  email: "a@x",
  phone: "600",
  since: new Date(),
  notes: "internas",
  infoGeneral: "info",
  servicios: ["seo_web"],
  kitDigital: true,
  prioridad: "NORMAL",
  brandBrief: "brief",
  website: "https://x",
  // sensibles
  mrr: 500,
  accesos: "cpanel: user/PASSWORD123",
  legalName: "Bar Pepe SL",
  taxId: "B123",
  fiscalAddress: "Calle Falsa 1",
  postalCode: "29000",
  city: "Ciudad",
  province: "Prov",
  countryCode: "ESP",
  sepaEnabled: true,
  sepaMandateRef: "MND-1",
  sepaMandateActive: true,
  sepaSantanderTemplate: "tpl",
  sepaIbanMasked: "ES**...**3456",
  stripeCustomerId: "cus_123",
  metaAdAccountId: "act_9",
  metaPageId: "page_9",
  metaInstagramId: "ig_9",
  metaLeadEmails: "a@x,b@y",
  deletedById: "u9",
  projects: [{ id: "p1", name: "P1" }]
};

const SENSITIVE_VALUES = [
  "cpanel: user/PASSWORD123", // accesos
  "cus_123", // stripe
  "act_9", "page_9", "ig_9", "a@x,b@y", // meta
  "MND-1", "ES**...**3456", // sepa
  "B123", "Bar Pepe SL" // fiscal
];

describe("serializeClient — no-admin (miembro/guest)", () => {
  const out = serializeClient(FULL, false);
  const json = JSON.stringify(out);

  it("NO expone ningún campo sensible (ni anidado)", () => {
    for (const k of CLIENT_ADMIN_FIELDS) expect(out[k]).toBeUndefined();
    for (const k of CLIENT_NEVER_FIELDS) expect(out[k]).toBeUndefined();
    for (const v of SENSITIVE_VALUES) expect(json).not.toContain(v);
    expect(json).not.toMatch(/PASSWORD/);
  });

  it("mantiene los campos públicos que usa la UI", () => {
    expect(out.name).toBe("Bar Pepe");
    expect(out.servicios).toEqual(["seo_web"]);
    expect(out.brandBrief).toBe("brief");
    expect(out.website).toBe("https://x");
    expect(out.contactName).toBe("Ana");
    expect(out.projects).toEqual([{ id: "p1", name: "P1" }]);
  });
});

describe("serializeClient — admin", () => {
  const out = serializeClient(FULL, true);
  const json = JSON.stringify(out);

  it("ve fiscal/económico y los campos que su modal round-trippea (accesos, sepa)", () => {
    expect(out.mrr).toBe(500);
    expect(out.taxId).toBe("B123");
    expect(out.accesos).toBe("cpanel: user/PASSWORD123");
    expect(out.sepaMandateRef).toBe("MND-1");
    expect(out.sepaIbanMasked).toBe("ES**...**3456");
  });

  it("stripe/meta NUNCA salen, ni para admin", () => {
    for (const k of CLIENT_NEVER_FIELDS) expect(out[k]).toBeUndefined();
    expect(json).not.toContain("cus_123");
    expect(json).not.toContain("act_9");
  });
});

describe("serializeClient — allowlist por construcción", () => {
  it("un campo NUEVO no listado no se expone a nadie", () => {
    const withNew = { ...FULL, newSecretField: "SUPERSECRET" };
    expect(JSON.stringify(serializeClient(withNew, true))).not.toContain("SUPERSECRET");
    expect(JSON.stringify(serializeClient(withNew, false))).not.toContain("SUPERSECRET");
  });
});
