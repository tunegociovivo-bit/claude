import { describe, it, expect } from "vitest";
import { computePresenceScore, PRESENCE_WEIGHTS, type PresenceInput } from "../presence-score";

const empty: PresenceInput = {
  profile: { hasDescription: false, hasCategory: false, hasPhone: false, hasWebsite: false, hasAddress: false, hasHours: false, photoCount: 0 },
  reviews: { count: 0, avgRating: 0, responseRate: 0 },
  content: { postsLast30: 0, photoCount: 0 },
  citations: { total: 0, published: 0, consistent: 0 },
  ranking: { keywordsTracked: 0, avgTop3Share: 0 },
  web: { hasWebsite: false, hasSchema: false }
};

const full: PresenceInput = {
  profile: { hasDescription: true, hasCategory: true, hasPhone: true, hasWebsite: true, hasAddress: true, hasHours: true, photoCount: 10 },
  reviews: { count: 60, avgRating: 5, responseRate: 1 },
  content: { postsLast30: 4, photoCount: 12 },
  citations: { total: 10, published: 10, consistent: 10 },
  ranking: { keywordsTracked: 5, avgTop3Share: 1 },
  web: { hasWebsite: true, hasSchema: true }
};

describe("computePresenceScore", () => {
  it("todo vacío → 0", () => {
    const r = computePresenceScore(empty);
    expect(r.total).toBe(0);
    expect(r.breakdown.ranking).toBe(0);
  });
  it("todo pleno → 100 con desglose máximo", () => {
    const r = computePresenceScore(full);
    expect(r.total).toBe(100);
    for (const k of Object.keys(r.breakdown) as (keyof typeof r.breakdown)[]) expect(r.breakdown[k]).toBe(100);
  });
  it("ranking sin keywords rastreadas → 0 honesto (no inventa)", () => {
    const r = computePresenceScore({ ...full, ranking: { keywordsTracked: 0, avgTop3Share: 0.9 } });
    expect(r.breakdown.ranking).toBe(0);
    expect(r.total).toBeLessThan(100);
  });
  it("pesos suman 100 y total está acotado 0..100", () => {
    expect(Object.values(PRESENCE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    const r = computePresenceScore({ ...full, reviews: { count: 3, avgRating: 3, responseRate: 0.2 } });
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });
});
