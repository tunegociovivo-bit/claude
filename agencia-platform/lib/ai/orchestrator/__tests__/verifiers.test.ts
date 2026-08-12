/**
 * Verificadores de dominio OBJETIVOS — adversarial. Longitud/no-vacío NUNCA basta;
 * sin criterios objetivos → verified:false; incompleto/mal estructurado/negativa → objFail.
 */
import { describe, it, expect } from "vitest";
import { verifyResult } from "../verifiers";

describe("resumen/análisis — cobertura de puntos clave", () => {
  const spec = { mustCoverKeyPoints: ["beneficio neto", "flujo de caja", "deuda financiera"] };
  it("cubre todos los puntos → objOk verified", () => {
    const out = "El beneficio neto creció; el flujo de caja fue positivo y la deuda financiera bajó.";
    const r = verifyResult({ taskType: "resumen", output: out, spec });
    expect(r).toMatchObject({ ok: true, verified: true, verifierType: "summary" });
    expect(r.evidence.coveredPoints).toBe(3);
  });
  it("un texto LARGO que omite un punto → objFail (longitud no basta)", () => {
    const out = "El beneficio neto creció mucho. ".repeat(30) + "El flujo de caja fue positivo.";
    const r = verifyResult({ taskType: "resumen", output: out, spec });
    expect(r).toMatchObject({ ok: false, verified: true }); // falta 'deuda financiera'
    expect(r.evidence.coveredPoints).toBe(2);
  });
  it("negativa del modelo → objFail (no resuelto)", () => {
    const r = verifyResult({ taskType: "analisis", output: "Lo siento, no puedo ayudar con eso.", spec });
    expect(r).toMatchObject({ ok: false, verified: true, evidence: { reason: "refusal_or_error" } });
  });
  it("sin puntos clave → verified:false (no aprende éxito)", () => {
    expect(verifyResult({ taskType: "resumen", output: "cualquier cosa", spec: {} })).toMatchObject({ ok: true, verified: false });
  });
});

describe("informe/documento — secciones requeridas", () => {
  const spec = { requiredSections: ["Introducción", "Resultados", "Conclusión"] };
  it("todas las secciones con contenido → objOk", () => {
    const out = "Introducción: contexto del caso. Resultados: subió 10%. Conclusión: seguir invirtiendo.";
    expect(verifyResult({ taskType: "informe", output: out, spec })).toMatchObject({ ok: true, verified: true, verifierType: "report" });
  });
  it("falta una sección → objFail", () => {
    const out = "Introducción: contexto. Resultados: subió 10%.";
    const r = verifyResult({ taskType: "documento", output: out, spec });
    expect(r).toMatchObject({ ok: false, verified: true });
    expect(r.evidence.missing).toBe(1);
  });
  it("sección presente pero SIN contenido tras el título → objFail", () => {
    const out = "Resultados: datos. Introducción: hola. Conclusión:";
    expect(verifyResult({ taskType: "informe", output: out, spec }).ok).toBe(false);
  });
});

describe("extracción/listado estructurado — esquema/formato", () => {
  const spec = { format: "json" as const, requiredFields: ["nombre", "email"], minItems: 2 };
  it("JSON válido con campos y items suficientes → objOk", () => {
    const out = '[{"nombre":"Ana","email":"a@x.com"},{"nombre":"Luis","email":"l@x.com"}]';
    expect(verifyResult({ taskType: "extraccion", output: out, spec })).toMatchObject({ ok: true, verified: true, verifierType: "structured" });
  });
  it("JSON envuelto en ```json → se extrae y valida", () => {
    const out = "Aquí tienes:\n```json\n[{\"nombre\":\"Ana\",\"email\":\"a@x.com\"},{\"nombre\":\"Z\",\"email\":\"z@x.com\"}]\n```";
    expect(verifyResult({ taskType: "listado", output: out, spec }).ok).toBe(true);
  });
  it("no parseable → objFail", () => {
    expect(verifyResult({ taskType: "structured", output: "no soy json", spec })).toMatchObject({ ok: false, verified: true, evidence: { reason: "no_parseable" } });
  });
  it("falta un campo requerido → objFail", () => {
    const out = '[{"nombre":"Ana"},{"nombre":"Luis","email":"l@x.com"}]';
    expect(verifyResult({ taskType: "extraccion", output: out, spec }).evidence.badItems).toBe(1);
  });
  it("menos items que minItems → objFail", () => {
    const out = '[{"nombre":"Ana","email":"a@x.com"}]';
    expect(verifyResult({ taskType: "extraccion", output: out, spec })).toMatchObject({ ok: false, evidence: { reason: "pocos_items" } });
  });
  it("CSV válido → objOk; CSV sin filas → objFail", () => {
    const okCsv = "nombre,email\nAna,a@x.com\nLuis,l@x.com";
    expect(verifyResult({ taskType: "listado", output: okCsv, spec: { format: "csv", requiredFields: ["nombre", "email"], minItems: 2 } }).ok).toBe(true);
    expect(verifyResult({ taskType: "listado", output: "nombre,email", spec: { format: "csv", minItems: 1 } }).ok).toBe(false);
  });
  it("sin formato → verified:false", () => {
    expect(verifyResult({ taskType: "extraccion", output: "[]", spec: {} })).toMatchObject({ verified: false });
  });
});

describe("comentario/actualización interna — referencias obligatorias", () => {
  const spec = { mustReference: ["TICKET-42", "cliente Acme"] };
  it("referencia todo lo requerido → objOk", () => {
    expect(verifyResult({ taskType: "comentario", output: "Actualizado el TICKET-42 para el cliente Acme.", spec })).toMatchObject({ ok: true, verified: true, verifierType: "comment" });
  });
  it("falta una referencia → objFail", () => {
    expect(verifyResult({ taskType: "actualizacion", output: "Actualizado el TICKET-42.", spec }).ok).toBe(false);
  });
});

describe("común / dispatcher", () => {
  it("mustNotContain presente → objFail guard", () => {
    expect(verifyResult({ taskType: "resumen", output: "contiene SECRETO_X aquí", spec: { mustCoverKeyPoints: ["x"], mustNotContain: ["SECRETO_X"] } })).toMatchObject({ ok: false, verified: true, verifierType: "guard" });
  });
  it("tipo desconocido → verified:false (no verificable objetivamente)", () => {
    expect(verifyResult({ taskType: "cosa_rara", output: "hola", spec: {} })).toMatchObject({ ok: true, verified: false, verifierType: "none" });
  });
});
