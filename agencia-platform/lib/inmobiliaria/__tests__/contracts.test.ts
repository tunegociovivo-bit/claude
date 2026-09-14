import { describe, expect, it } from "vitest";
import { businessPremisesSearchSchema } from "@/lib/inmobiliaria/contracts";

describe("businessPremisesSearchSchema", () => {
  it("applies safe defaults for a rental search", () => {
    const parsed = businessPremisesSearchSchema.parse({ location: "Málaga", portals: [] });
    expect(parsed.operation).toBe("rent");
    expect(parsed.allowOpenPlan).toBe(true);
    expect(parsed.preferStreetLevel).toBe(true);
    expect(parsed.basementPolicy).toBe("allow_penalize");
  });

  it("rejects an inverted surface range", () => {
    const parsed = businessPremisesSearchSchema.safeParse({
      location: "Málaga",
      minSurface: 140,
      maxSurface: 100,
      portals: []
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects purchase-only costs in a rental search", () => {
    const parsed = businessPremisesSearchSchema.safeParse({
      location: "Málaga",
      operation: "rent",
      maxPurchasePrice: 200_000,
      portals: []
    });
    expect(parsed.success).toBe(false);
  });
});
