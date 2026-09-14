import { describe, expect, it } from "vitest";
import { businessPremisesSearchSchema, OPPORTUNITY_SCHEMA } from "@/lib/inmobiliaria/contracts";

function countUnionParameters(schema: unknown): number {
  if (!schema || typeof schema !== "object") return 0;
  if (Array.isArray(schema)) return schema.reduce((total, item) => total + countUnionParameters(item), 0);
  const record = schema as Record<string, unknown>;
  const self = Array.isArray(record.anyOf) || Array.isArray(record.type) ? 1 : 0;
  return self + Object.values(record).reduce((total, item) => total + countUnionParameters(item), 0);
}

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

  it("keeps the Anthropic schema under the union parameter limit", () => {
    expect(countUnionParameters(OPPORTUNITY_SCHEMA)).toBeLessThanOrEqual(16);
  });
});
