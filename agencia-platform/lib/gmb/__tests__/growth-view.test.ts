import { describe, it, expect } from "vitest";
import { GROWTH_TABS, demoPanelCount, demoPanelVisible } from "../growth-view";

// Prueba PARAMETRIZADA: ninguna de las 9 pestañas del Centro de crecimiento puede quedar vacía en
// demo (regresión QA de AI Council y de cualquier otro panel).
describe("demo de las 9 pestañas — contenido visible", () => {
  it("hay exactamente 9 pestañas", () => {
    expect(GROWTH_TABS).toHaveLength(9);
  });
  it.each(GROWTH_TABS)("la pestaña '%s' muestra contenido en demo", (tab) => {
    expect(demoPanelVisible(tab)).toBe(true);
    expect(demoPanelCount(tab)).toBeGreaterThan(0);
  });
  it("AI Council demo incluye proveedores + resultado de ejemplo (regresión)", () => {
    // proveedores (4) + propuestas (2) + discrepancias (1) = 7
    expect(demoPanelCount("aicouncil")).toBeGreaterThanOrEqual(7);
  });
});
