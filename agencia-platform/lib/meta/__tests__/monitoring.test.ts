import { describe, expect, it } from "vitest";
import { buildFortnightBuckets, buildMonitoringRecommendations } from "@/lib/meta/monitoring";

describe("Meta monitoring", () => {
  it("creates six real 15-day buckets and fills missing days with zero", () => {
    const buckets = buildFortnightBuckets([
      { date: "2026-08-18", leads: 3, spend: 30 },
      { date: "2026-08-04", leads: 2, spend: 10 }
    ], new Date("2026-08-18T12:00:00Z"));
    expect(buckets).toHaveLength(6);
    expect(buckets[5]).toMatchObject({ from: "2026-08-04", to: "2026-08-18", leads: 5, spend: 40, cpl: 8 });
    expect(buckets.slice(0, 5).every((item) => item.leads === 0)).toBe(true);
  });

  it("detects a material lead decline", () => {
    const recommendations = buildMonitoringRecommendations([], -25);
    expect(recommendations.some((item) => item.title === "Caída relevante de leads" && item.severity === "high")).toBe(true);
  });

  it("detects spend without attributed leads", () => {
    const recommendations = buildMonitoringRecommendations([{ id: "1", name: "Test", leads: 0, spend: 200, ctr: 1, impressions: 500 }], null);
    expect(recommendations.some((item) => item.title === "Gasto sin leads")).toBe(true);
  });
});
