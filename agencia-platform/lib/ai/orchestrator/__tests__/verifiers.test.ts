/**
 * Verificadores de dominio OBJETIVOS — adversarial. Éxito solo si es objetivamente
 * inequívoco (nunca por longitud/eco). Cobertura/sección/referencia insuficiente →
 * softFail (reintenta, NO aprende). Negativa/estructura rota → objFail (aprende).
 */
import { describe, it, expect } from "vitest";
import { verifyResult } from "../verifiers";

describe("resumen/análisis — cobertura + anti-eco + compresión", () => {
  const spec = { mustCoverKeyPoints: ["beneficio neto", "flujo de caja", "deuda financiera"] };
  it("resumen real (cubre todo + contenido sustancial) → objOk verified", () => {
    const out = "Durante el ejercicio el beneficio neto mejoró gracias a mayores ventas y control de gastos operativos; el flujo de caja se mantuvo positivo pese a las inversiones realizadas, y la deuda financiera se redujo tras amortizar parte del préstamo bancario contratado el año pasado.";
    const r = verifyResult({ taskType: "resumen", output: out, spec });
    expect(r).toMatchObject({ ok: true, verified: true, verifierType: "summary" });
  });
  it("PARROTING (solo repite las palabras clave) → NO verified (posible eco)", () => {
    const out = "beneficio neto flujo de caja deuda financiera";
    const r = verifyResult({ taskType: "resumen", output: out, spec });
    expect(r.verified).toBe(false); // no se aprende un éxito manufacturado
  });
  it("devolver la fuente literal (sin compresión) → NO verified", () => {
    const out = "El beneficio neto mejoró y el flujo de caja fue positivo y la deuda financiera bajó considerablemente durante el periodo analizado con detalle.";
    const r = verifyResult({ taskType: "resumen", output: out, spec: { ...spec, sourceLength: 200, sourceMaxRatio: 0.5 } });
    expect(r.verified).toBe(false); // output > 0.5*200 → sin compresión
  });
  it("omite un punto → softFail (reintenta, NO aprende)", () => {
    const out = "El beneficio neto creció mucho y el flujo de caja fue muy positivo en el trimestre analizado.";
    const r = verifyResult({ taskType: "resumen", output: out, spec });
    expect(r).toMatchObject({ ok: false, verified: false }); // falta 'deuda financiera'
  });
  it("negativa del modelo (encabeza) → objFail verified", () => {
    expect(verifyResult({ taskType: "analisis", output: "Lo siento, no puedo ayudar con eso.", spec })).toMatchObject({ ok: false, verified: true, evidence: { reason: "refusal" } });
  });
  it("resumen que CITA una negativa dentro del contenido NO se marca fallo por ello", () => {
    const out = "Resumen de la llamada: el beneficio neto bajó porque un cliente dijo que no puedo pagar ahora; el flujo de caja se resintió y la deuda financiera aumentó ligeramente según el informe interno revisado.";
    const r = verifyResult({ taskType: "resumen", output: out, spec });
    expect(r.evidence?.reason).not.toBe("refusal"); // la negativa está en el contenido, no encabeza
  });
  it("sin puntos clave → verified:false", () => {
    expect(verifyResult({ taskType: "resumen", output: "cualquier cosa", spec: {} })).toMatchObject({ ok: true, verified: false });
  });
});

describe("informe/documento — secciones con CONTENIDO propio", () => {
  const spec = { requiredSections: ["Introducción", "Resultados", "Conclusión"] };
  it("cada sección con contenido propio → objOk", () => {
    const out = "Introducción: este documento analiza el rendimiento trimestral del negocio. Resultados: los ingresos aumentaron considerablemente respecto al periodo anterior. Conclusión: recomendamos mantener la estrategia comercial actual.";
    expect(verifyResult({ taskType: "informe", output: out, spec })).toMatchObject({ ok: true, verified: true, verifierType: "report" });
  });
  it("solo la LISTA de encabezados (stub sin contenido) → softFail (no verified)", () => {
    const r = verifyResult({ taskType: "informe", output: "Introducción, Resultados, Conclusión", spec });
    expect(r).toMatchObject({ ok: false, verified: false });
    expect(r.evidence.thin).toBeGreaterThan(0);
  });
  it("falta una sección → softFail", () => {
    const out = "Introducción: contexto del negocio analizado. Resultados: crecimiento del diez por ciento.";
    expect(verifyResult({ taskType: "documento", output: out, spec })).toMatchObject({ ok: false, verified: false, evidence: { missing: 1 } });
  });
});

describe("extracción/listado estructurado — esquema/formato (verificación fuerte)", () => {
  const spec = { format: "json" as const, requiredFields: ["nombre", "email"], minItems: 2 };
  it("JSON válido con campos y items suficientes → objOk verified", () => {
    const out = '[{"nombre":"Ana","email":"a@x.com"},{"nombre":"Luis","email":"l@x.com"}]';
    expect(verifyResult({ taskType: "extraccion", output: out, spec })).toMatchObject({ ok: true, verified: true, verifierType: "structured" });
  });
  it("JSON envuelto en fence → se extrae y valida", () => {
    const out = "Aquí tienes:\n```json\n[{\"nombre\":\"Ana\",\"email\":\"a@x.com\"},{\"nombre\":\"Z\",\"email\":\"z@x.com\"}]\n```";
    expect(verifyResult({ taskType: "listado", output: out, spec }).ok).toBe(true);
  });
  it("no parseable → objFail SIN fragmento del output crudo", () => {
    const r = verifyResult({ taskType: "structured", output: "[cliente factura 4111 pendiente de revision]", spec });
    expect(r).toMatchObject({ ok: false, verified: true, evidence: { reason: "no_parseable" } });
    expect(JSON.stringify(r.evidence)).not.toMatch(/cliente|4111/); // sin PII/output crudo
  });
  it("falta un campo requerido → objFail", () => {
    const out = '[{"nombre":"Ana"},{"nombre":"Luis","email":"l@x.com"}]';
    expect(verifyResult({ taskType: "extraccion", output: out, spec })).toMatchObject({ ok: false, verified: true, evidence: { badItems: 1 } });
  });
  it("primitivos en vez de objetos → objFail", () => {
    expect(verifyResult({ taskType: "extraccion", output: '["Ana","Luis"]', spec }).evidence.badItems).toBe(2);
  });
  it("menos items que minItems → objFail", () => {
    expect(verifyResult({ taskType: "extraccion", output: '[{"nombre":"Ana","email":"a@x.com"}]', spec })).toMatchObject({ ok: false, verified: true, evidence: { reason: "pocos_items" } });
  });
  it("resultado VACÍO nunca cuenta como resuelto aunque el spec pida minItems:0", () => {
    expect(verifyResult({ taskType: "extraccion", output: "[]", spec: { format: "json", minItems: 0 } })).toMatchObject({ ok: false, verified: true, evidence: { reason: "pocos_items" } });
  });
  it("CSV válido → objOk; CSV sin filas → objFail", () => {
    const okCsv = "nombre,email\nAna,a@x.com\nLuis,l@x.com";
    expect(verifyResult({ taskType: "listado", output: okCsv, spec: { format: "csv", requiredFields: ["nombre", "email"], minItems: 2 } })).toMatchObject({ ok: true, verified: true });
    expect(verifyResult({ taskType: "listado", output: "nombre,email", spec: { format: "csv", minItems: 1 } })).toMatchObject({ ok: false, verified: true });
  });
  it("sin formato → verified:false", () => {
    expect(verifyResult({ taskType: "extraccion", output: "[]", spec: {} })).toMatchObject({ verified: false });
  });
});

describe("comentario/actualización — referencias obligatorias", () => {
  const spec = { mustReference: ["TICKET-42", "Acme"] };
  it("referencia todo lo requerido → objOk verified", () => {
    expect(verifyResult({ taskType: "comentario", output: "Actualizado el TICKET-42 para el cliente Acme con la nueva información.", spec })).toMatchObject({ ok: true, verified: true, verifierType: "comment" });
  });
  it("falta una referencia → softFail (reintenta, no aprende)", () => {
    expect(verifyResult({ taskType: "actualizacion", output: "Actualizado el TICKET-42 con la información.", spec })).toMatchObject({ ok: false, verified: false });
  });
});

describe("común / dispatcher", () => {
  it("mustNotContain presente → objFail guard", () => {
    expect(verifyResult({ taskType: "resumen", output: "contiene SECRETO_X aquí", spec: { mustCoverKeyPoints: ["x"], mustNotContain: ["SECRETO_X"] } })).toMatchObject({ ok: false, verified: true, verifierType: "guard" });
  });
  it("tipo desconocido → verified:false (no verificable objetivamente)", () => {
    expect(verifyResult({ taskType: "cosa_rara", output: "hola", spec: {} })).toMatchObject({ ok: true, verified: false, verifierType: "none" });
  });
  it("informe con 'error:' o traceback en el contenido NO se marca fallo por ello", () => {
    const out = "Introducción: informe de incidencias del sistema durante la semana pasada. Resultados: se registró un error: timeout y un traceback en el módulo de pagos que fue resuelto. Conclusión: se aplicó el parche y quedó estable definitivamente.";
    const r = verifyResult({ taskType: "informe", output: out, spec: { requiredSections: ["Introducción", "Resultados", "Conclusión"] } });
    expect(r.verified).toBe(true); // los marcadores de error legítimos no lo tumban
    expect(r.ok).toBe(true);
  });
});
