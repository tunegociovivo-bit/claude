import { describe, expect, it } from "vitest";
import { attributionMetrics, stageDates } from "@/lib/meta/attribution";

describe("Meta attribution", () => {
  it("calculates quality and revenue metrics", () => {
    const result = attributionMetrics([{ status: "won", revenueCents: 100000 }, { status: "qualified", revenueCents: 0 }, { status: "invalid", revenueCents: 0 }], 200);
    expect(result).toMatchObject({ total: 3, qualified: 2, won: 1, invalid: 1, revenue: 1000, costPerQualifiedLead: 100, costPerSale: 200, roas: 5 });
  });
  it("stamps commercial milestones", () => { expect(stageDates("proposal", new Date("2026-08-19"))).toHaveProperty("proposalAt"); });
});
