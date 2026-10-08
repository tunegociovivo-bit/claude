import { describe, expect, it } from "vitest";
import {
  cleanBusinessName,
  fillBusinessName,
  findUnresolvedPlaceholders,
  isBusinessNameKey,
  mentionsBusinessName,
  resolveBusinessName
} from "../placeholders";

describe("placeholders · nombre del negocio", () => {
  it("rellena {{nombre}} (el caso real que llegaba a los leads)", () => {
    const sent =
      "Hola, He visto que {{nombre}} está bien posicionado en la zona, aunque hay margen de mejora frente a competidores cercanos.";
    const out = fillBusinessName(sent, "Peluquería Ana");
    expect(out).toContain("He visto que Peluquería Ana está bien posicionado");
    expect(findUnresolvedPlaceholders(out)).toEqual([]);
  });

  it("acepta cualquier alias, mayúsculas, tildes y espacios", () => {
    for (const ph of [
      "{{nombre}}", "{{ nombre }}", "{{Nombre}}", "{{NOMBRE_NEGOCIO}}", "{{nombre_negocio}}",
      "{{negocio}}", "{{empresa}}", "{{companyName}}", "{{Nombre del negocio}}", "{{nombre_empresa}}",
      "{nombre}", "[nombre del negocio]", "[Nombre]"
    ]) {
      expect(fillBusinessName(`Hola ${ph}, ¿qué tal?`, "Bar Sol")).toBe("Hola Bar Sol, ¿qué tal?");
    }
  });

  it("no toca llaves/corchetes normales ni otros placeholders", () => {
    expect(fillBusinessName("Pack [básico] {oferta}", "Bar Sol")).toBe("Pack [básico] {oferta}");
    expect(fillBusinessName("{{provincia}}", "Bar Sol")).toBe("{{provincia}}");
  });

  it("con nombre vacío no sustituye (la barrera bloquea)", () => {
    expect(fillBusinessName("Hola {{nombre}}", "")).toBe("Hola {{nombre}}");
    expect(findUnresolvedPlaceholders("Hola {{nombre}}")).toEqual(["{{nombre}}"]);
  });

  it("detecta placeholders sin resolver, también cortados", () => {
    expect(findUnresolvedPlaceholders("Hemos analizado cómo aparece {{ciudad}} hoy")).toEqual(["{{ciudad}}"]);
    expect(findUnresolvedPlaceholders("Hemos analizado cómo aparece {{no")).toHaveLength(1);
    expect(findUnresolvedPlaceholders("Hola [nombre], te escribo")).toEqual(["[nombre]"]);
    expect(findUnresolvedPlaceholders("Hola Bar Sol, pack [básico]")).toEqual([]);
    expect(findUnresolvedPlaceholders(null)).toEqual([]);
  });

  it("resuelve el nombre del lead y cae a los datos crudos de Google", () => {
    expect(resolveBusinessName({ name: "  Clínica   March " })).toBe("Clínica March");
    expect(resolveBusinessName({ name: "", rawData: { displayName: { text: "Taller Pepe" } } })).toBe("Taller Pepe");
    expect(resolveBusinessName({ name: "", rawData: { name: "places/ChIJ123", title: "Café Luz" } })).toBe("Café Luz");
    expect(resolveBusinessName({ name: "", rawData: null })).toBe("");
    expect(resolveBusinessName(null)).toBe("");
  });

  it("utilidades de apoyo", () => {
    expect(isBusinessNameKey("Nombre del negocio")).toBe(true);
    expect(isBusinessNameKey("provincia")).toBe(false);
    expect(cleanBusinessName('"Bar Sol"')).toBe("Bar Sol");
    expect(mentionsBusinessName("Hola, he visto CLINICA MARCH en Google", "Clínica March")).toBe(true);
    expect(mentionsBusinessName("Hola, he visto tu negocio en Google", "Clínica March")).toBe(false);
  });

  it("un nombre con $ no rompe la sustitución", () => {
    expect(fillBusinessName("Hola {{nombre}}", "Tienda $1 & Co")).toBe("Hola Tienda $1 & Co");
  });
});
