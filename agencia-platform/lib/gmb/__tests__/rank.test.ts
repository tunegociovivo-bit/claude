import { describe, it, expect } from "vitest";
import { buildGrid, aggregateGrid, competitorGaps, rankProviderStatus } from "../rank";

describe("buildGrid", () => {
  it("genera NxN centrado, tamaño acotado a 9", () => {
    const g = buildGrid(36.7, -4.4, 3, 1);
    expect(g).toHaveLength(9);
    // el centro (row1,col1) coincide con el centro dado
    const center = g.find((c) => c.row === 1 && c.col === 1)!;
    expect(center.lat).toBeCloseTo(36.7, 3);
    expect(center.lng).toBeCloseTo(-4.4, 3);
    expect(buildGrid(36.7, -4.4, 99, 1)).toHaveLength(81); // clamp a 9x9
  });
});

describe("aggregateGrid", () => {
  it("posición media solo de celdas donde aparece + top3 + cobertura", () => {
    const s = aggregateGrid([{ position: 1 }, { position: 5 }, { position: null }, { position: 0 }]);
    expect(s.foundCount).toBe(2); // 1 y 5 (0 y null no cuentan)
    expect(s.top3Count).toBe(1);
    expect(s.avgPosition).toBe(3);
    expect(s.visibilityShare).toBe(50);
  });
  it("sin apariciones → 0 honesto", () => {
    const s = aggregateGrid([{ position: null }, { position: 0 }]);
    expect(s.foundCount).toBe(0);
    expect(s.avgPosition).toBe(0);
  });
});

describe("competitorGaps", () => {
  it("calcula gaps de reseñas/nota y categorías que te faltan", () => {
    const gap = competitorGaps({ rating: 4.2, reviewCount: 30, categories: ["cafeteria"] }, [
      { name: "A", rating: 4.6, reviewCount: 120, categories: ["cafeteria", "desayunos"] },
      { name: "B", rating: 4.4, reviewCount: 80, categories: ["brunch"] }
    ]);
    expect(gap.reviewGap).toBe(70); // media 100 - 30
    expect(gap.ratingGap).toBeCloseTo(0.3, 1);
    expect(gap.categoryGaps).toContain("desayunos");
    expect(gap.categoryGaps).toContain("brunch");
    expect(gap.ahead).toBe(false);
  });
});

describe("rankProviderStatus", () => {
  it("sin clave de Maps → no conectado (honesto)", () => {
    expect(rankProviderStatus({} as any)).toMatchObject({ connected: false });
  });
  it("con clave → conectado", () => {
    expect(rankProviderStatus({ GOOGLE_MAPS_API_KEY: "x" } as any).connected).toBe(true);
  });
});
