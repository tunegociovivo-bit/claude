/**
 * Contrato FASE 3b · UI — helpers de presentación puros del panel 360.
 */
import { describe, it, expect } from "vitest";
import { bandLabel, bandClasses, alertClasses, formatEurCents, activityLabel } from "../health-ui";

describe("bandLabel / bandClasses", () => {
  it("etiqueta y clases por banda (texto + color, no solo color)", () => {
    expect(bandLabel("good")).toBe("Saludable");
    expect(bandLabel("warn")).toBe("Atención");
    expect(bandLabel("risk")).toBe("En riesgo");
    expect(bandClasses("risk").dot).toContain("rose");
    expect(bandClasses("good").ring).toContain("emerald");
  });
});

describe("alertClasses", () => {
  it("critical/warn/info", () => {
    expect(alertClasses("critical")).toContain("rose");
    expect(alertClasses("warn")).toContain("amber");
    expect(alertClasses("info")).toContain("slate");
  });
});

describe("formatEurCents", () => {
  it("céntimos → euros con decimal es-ES; robusto ante no-números", () => {
    // Nota: el separador de miles depende del ICU del entorno; solo verificamos
    // el decimal (coma) y el símbolo, no el agrupamiento.
    expect(formatEurCents(123456)).toMatch(/234,56\s?€/);
    expect(formatEurCents(0)).toMatch(/0,00\s?€/);
    expect(formatEurCents(NaN as any)).toMatch(/0,00\s?€/);
  });
});

describe("activityLabel", () => {
  it("null → sin datos; 0/1/n días", () => {
    expect(activityLabel(null)).toMatch(/[Ss]in actividad/);
    expect(activityLabel(0)).toMatch(/hoy/i);
    expect(activityLabel(1)).toMatch(/1 día/);
    expect(activityLabel(5)).toMatch(/5 días/);
  });
});
