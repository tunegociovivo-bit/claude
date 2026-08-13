/**
 * Guarda de la mejora "locales por marca": los leads de LOCALES (source places,
 * rawData.source="brand_locations", placeId real de Google) son CONTACTABLES normales y
 * NO deben heredar el bloqueo email-only de las CENTRALES de franquicia.
 */
import { describe, it, expect } from "vitest";
import { isEmailOnlyLead } from "../email-only";

describe("isEmailOnlyLead — centrales sí, locales por marca no", () => {
  it("central de franquicia (placeId franchise:*) → email-only", () => {
    expect(isEmailOnlyLead({ placeId: "franchise:acme", rawData: {}, search: { source: "franchises" } })).toBe(true);
  });
  it("rawData.source=franchises → email-only (señal redundante)", () => {
    expect(isEmailOnlyLead({ placeId: "ChIJ_real", rawData: { source: "franchises" }, search: { source: "places" } })).toBe(true);
  });
  it("search.source=franchises → email-only", () => {
    expect(isEmailOnlyLead({ placeId: "ChIJ_real", rawData: {}, search: { source: "franchises" } })).toBe(true);
  });

  it("LOCAL por marca (source places + rawData.source brand_locations + placeId real) → NO email-only", () => {
    const brandLocation = {
      placeId: "ChIJ_alcampo_moratalaz",
      rawData: { source: "brand_locations", brand: "Alcampo" },
      search: { source: "places" }
    };
    expect(isEmailOnlyLead(brandLocation)).toBe(false); // contactable normal (WhatsApp + email)
  });
  it("lead normal de places → NO email-only", () => {
    expect(isEmailOnlyLead({ placeId: "ChIJ_x", rawData: { source: "places" }, search: { source: "places" } })).toBe(false);
  });
});
