import { describe, it, expect } from "vitest";
import { normalizeName, normalizeAddress, normalizePhone, normalizeWebsite, compareNap, hasNapInconsistency } from "../nap";

describe("NAP normalization", () => {
  it("nombre: minúsculas, sin acentos ni forma jurídica", () => {
    expect(normalizeName("Alimentación Sergisa, S.L.")).toBe("alimentacion sergisa");
    expect(normalizeName("BAR PEPE S.L.U.")).toBe("bar pepe");
    expect(normalizeName("Clínica Dental & Estética SA")).toBe("clinica dental y estetica");
  });
  it("dirección: abreviaturas de vía expandidas", () => {
    expect(normalizeAddress("C/ Calvario, 32")).toBe("calle calvario 32");
    expect(normalizeAddress("Avda. de Andalucía nº5")).toBe("avenida de andalucia 5");
  });
  it("teléfono español a 9 dígitos (quita +34/espacios)", () => {
    expect(normalizePhone("+34 952 79 66 58")).toBe("952796658");
    expect(normalizePhone("952-796-658")).toBe("952796658");
  });
  it("web a host canónico", () => {
    expect(normalizeWebsite("https://www.Sergisa.es/contacto")).toBe("sergisa.es");
    expect(normalizeWebsite("sergisa.es")).toBe("sergisa.es");
  });
});

describe("compareNap", () => {
  const canonical = { name: "Alimentación Sergisa SL", address: "C/ Calvario 32, Estepona", phone: "+34 952796658", website: "sergisa.es" };
  it("iguales (formas distintas) → sin diferencias", () => {
    const diff = compareNap(canonical, { name: "ALIMENTACION SERGISA, S.L.", address: "Calle Calvario, 32", phone: "952 79 66 58", website: "http://www.sergisa.es" });
    expect(hasNapInconsistency(diff)).toBe(false);
  });
  it("teléfono distinto → phone difiere", () => {
    const diff = compareNap(canonical, { phone: "952000000" });
    expect(diff.phone).toBe(true);
    expect(diff.name).toBe(false); // ausente en observado → no cuenta
  });
  it("campo ausente en observado no cuenta como diferencia", () => {
    const diff = compareNap(canonical, {});
    expect(hasNapInconsistency(diff)).toBe(false);
  });
});
