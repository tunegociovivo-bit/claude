import { describe, expect, it } from "vitest";
import { hasDeliveryChannel, isLowValueBusinessOpportunity } from "../subvenciones/operations";

describe("cazador de subvenciones", () => {
  it("permite WhatsApp aunque no exista webhook de Make", () => {
    expect(hasDeliveryChannel("", "34600000000")).toBe(true);
  });

  it("permite webhook aunque no exista WhatsApp", () => {
    expect(hasDeliveryChannel("https://hook.example.test", "")).toBe(true);
  });

  it("descarta nominativas sin señal empresarial", () => {
    expect(isLowValueBusinessOpportunity({ titulo: "Subvención nominativa a una asociación cultural" })).toBe(true);
  });

  it("conserva convocatorias destinadas a pymes", () => {
    expect(isLowValueBusinessOpportunity({ titulo: "Ayudas para pymes y autónomos" })).toBe(false);
  });
});
