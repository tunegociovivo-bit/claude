import { describe, expect, it } from "vitest";
import type { BusinessPremisesSearch, Opportunity } from "@/lib/inmobiliaria/contracts";
import { matchAndRankOpportunities } from "@/lib/inmobiliaria/matching";

const search: BusinessPremisesSearch = {
  location: "Málaga",
  operation: "rent",
  minSurface: 100,
  maxSurface: 140,
  minCabins: 4,
  allowOpenPlan: true,
  preferStreetLevel: true,
  preferSingleFloor: true,
  basementPolicy: "allow_penalize",
  requiredSpaces: ["reception_waiting", "cabins", "staff_area", "laundry_storage", "toilets"],
  maxMonthlyRent: 2_500,
  maxFitOutBudget: 50_000,
  preferReadyToEnter: true,
  portals: [],
  maxResults: 80,
  onlyMatches: false
};

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "ref-1", portal: "idealista", portal_label: "Idealista", bank: "Portal generalista",
    title: "Local en alquiler", property_type: "Local", location: "Calle Larios 10, Málaga",
    url: "https://www.idealista.com/inmueble/123/", url_verified: true, price: 2_000, surface: 110, price_m2: null,
    estimated_market_price: null, discount_pct: null, estimated_rent: null, gross_yield: null,
    score: 0, verdict: "INTERESANTE", occupied: false, pros: [], cons: [], reasoning: "",
    operation: "rent", monthly_rent: 2_000, sale_price: null, transfer_price: null,
    existing_cabins: 0, cabin_capacity: null, layout: "open_plan", floor: "street",
    single_floor: true, has_basement: false,
    spaces: { reception_waiting: null, cabins: null, staff_area: null, laundry_storage: null, toilets: true },
    condition: "minor_works", fit_out_estimate: { min: 15_000, max: 35_000 },
    initial_investment: { confirmedLowerBound: 2_000, estimatedMin: 17_000, estimatedMax: 37_000, complete: false },
    evidence: [
      { field: "operation", status: "confirmed", text: "alquiler" },
      { field: "surface", status: "confirmed", text: "110 m²" },
      { field: "monthly_rent", status: "confirmed", text: "2.000 €/mes" },
      { field: "floor", status: "confirmed", text: "planta calle" }
    ],
    unknown_fields: [], fit_breakdown: [], fit_confidence: 0, sources: [], ...overrides
  };
}

describe("matchAndRankOpportunities", () => {
  it("keeps an open-plan local when cabins can be created", () => {
    const result = matchAndRankOpportunities([opportunity()], search);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].fit_breakdown.find((item) => item.key === "cabins")?.status).toBe("partial");
  });

  it("hard-filters only confirmed surface mismatches", () => {
    const confirmed = opportunity({ id: "confirmed", surface: 90 });
    const unknown = opportunity({
      id: "unknown",
      url: "https://www.idealista.com/inmueble/456/",
      location: "Calle Granada 25, Málaga",
      surface: 90,
      evidence: confirmed.evidence.filter((item) => item.field !== "surface")
    });
    const result = matchAndRankOpportunities([confirmed, unknown], search);
    expect(result.hardFiltered).toBe(1);
    expect(result.opportunities.map((item) => item.id)).toContain("unknown");
  });

  it("deduplicates tracking variants of the same URL", () => {
    const duplicate = opportunity({
      id: "ref-2",
      url: "https://www.idealista.com/inmueble/123/?utm_source=mail"
    });
    const result = matchAndRankOpportunities([opportunity(), duplicate], search);
    expect(result.duplicatesMerged).toBe(1);
    expect(result.opportunities[0].sources.length).toBeGreaterThanOrEqual(1);
  });

  it("does not deduplicate cross-portal listings with only a generic location", () => {
    const first = opportunity({ location: "Málaga", url: "", portal: "idealista", portal_label: "Idealista" });
    const second = opportunity({ id: "ref-2", location: "Málaga", url: "", portal: "fotocasa", portal_label: "Fotocasa" });
    const result = matchAndRankOpportunities([first, second], search);
    expect(result.duplicatesMerged).toBe(0);
    expect(result.opportunities).toHaveLength(2);
  });

  it("does not deduplicate a street without a number", () => {
    const first = opportunity({ location: "Calle Alcalá, Madrid", url: "", portal: "idealista", portal_label: "Idealista" });
    const second = opportunity({ id: "ref-2", location: "Calle Alcalá, Madrid", url: "", portal: "fotocasa", portal_label: "Fotocasa" });
    const result = matchAndRankOpportunities([first, second], search);
    expect(result.duplicatesMerged).toBe(0);
  });

  it("keeps a dual-operation listing when either modality fits its budget", () => {
    const dualSearch: BusinessPremisesSearch = {
      ...search,
      operation: "both",
      maxMonthlyRent: 1_500,
      maxPurchasePrice: 250_000
    };
    const dual = opportunity({
      operation: "both",
      monthly_rent: 2_000,
      sale_price: 200_000,
      evidence: [
        { field: "operation", status: "confirmed", text: "alquiler o venta" },
        { field: "monthly_rent", status: "confirmed", text: "2.000 €/mes" },
        { field: "sale_price", status: "confirmed", text: "200.000 €" }
      ]
    });
    const result = matchAndRankOpportunities([dual], dualSearch);
    expect(result.hardFiltered).toBe(0);
    expect(result.opportunities).toHaveLength(1);
  });

  it("does not hard-filter a conflicting confirmed field", () => {
    const conflict = opportunity({
      surface: 90,
      evidence: [
        { field: "surface", status: "confirmed", text: "90 m²" },
        { field: "surface", status: "conflicting", text: "otra fuente indica 110 m²" }
      ]
    });
    const result = matchAndRankOpportunities([conflict], search);
    expect(result.hardFiltered).toBe(0);
    expect(result.opportunities).toHaveLength(1);
  });

  it("marks merged source disagreements and does not hard-filter them", () => {
    const excludeBasements: BusinessPremisesSearch = { ...search, basementPolicy: "exclude" };
    const street = opportunity({ url: "", floor: "street" });
    const basement = opportunity({
      id: "ref-2",
      url: "",
      portal: "fotocasa",
      portal_label: "Fotocasa",
      floor: "basement",
      evidence: street.evidence.map((item) => item.field === "floor"
        ? { ...item, text: "sótano" }
        : item)
    });
    const result = matchAndRankOpportunities([street, basement], excludeBasements);
    expect(result.duplicatesMerged).toBe(1);
    expect(result.hardFiltered).toBe(0);
    expect(result.opportunities[0].evidence).toContainEqual(expect.objectContaining({ field: "floor", status: "conflicting" }));
  });
});
