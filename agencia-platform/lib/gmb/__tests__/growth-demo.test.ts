import { describe, it, expect } from "vitest";
import { GROWTH_DEMO } from "../growth-demo";

// Regresión QA: ningún panel de la demo puede quedar vacío (Acciones incluida).
describe("GROWTH_DEMO — ningún panel vacío", () => {
  it("presencia tiene score y oportunidades", () => {
    expect(GROWTH_DEMO.presence.score).toBeGreaterThan(0);
    expect(GROWTH_DEMO.presence.opportunities.length).toBeGreaterThan(0);
  });
  it("acciones NO está vacía (bug QA)", () => {
    expect(GROWTH_DEMO.actions.actions.length).toBeGreaterThanOrEqual(3);
    expect(GROWTH_DEMO.actions.summary.open).toBeGreaterThan(0);
  });
  it("AI Council trae ejemplo con consenso y discrepancias, sin conexión real", () => {
    expect(GROWTH_DEMO.aiCouncil.connectedCount).toBe(0); // demo = ningún proveedor conectado
    expect(GROWTH_DEMO.aiCouncil.exampleRun.proposals.length).toBeGreaterThan(0);
    expect(GROWTH_DEMO.aiCouncil.exampleRun.discrepancies.length).toBeGreaterThan(0);
  });
  it("rank/reseñas/contenido/web/citaciones tienen contenido", () => {
    expect(GROWTH_DEMO.rank.keywords.length).toBeGreaterThan(0);
    expect(GROWTH_DEMO.reviews.items.length).toBeGreaterThan(0);
    expect(GROWTH_DEMO.content.ideas.length).toBeGreaterThan(0);
    expect(GROWTH_DEMO.web.recommendations.length).toBeGreaterThan(0);
    expect(GROWTH_DEMO.citations.citations.length).toBeGreaterThan(0);
  });
});
