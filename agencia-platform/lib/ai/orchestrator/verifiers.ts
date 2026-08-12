/**
 * Verificadores de dominio OBJETIVOS para los A0/A1 habituales de Sonia. Deciden si una
 * tarea quedó REALMENTE resuelta (no por longitud/no-vacío), validando criterios de
 * aceptación derivados de la tarea: cobertura de puntos clave, secciones requeridas,
 * estructura/esquema, referencias obligatorias, y ausencia de error/negativa.
 *
 * Contrato: `{ ok, verified, verifierType, evidence }`.
 *  - `verified:true` SOLO cuando hay una comprobación objetiva segura (y la evidencia es
 *    estructurada, sin texto crudo/PII). Si el tipo no aporta criterios objetivos →
 *    `verified:false` (el motor completa pero NO aprende el éxito).
 *  - `ok:false` con `verified:true` = fallo OBJETIVO (incompleto / mal estructurado /
 *    negativa) → se diagnostica y se aprende para evitar esa estrategia.
 * Puro y determinista. No almacena la salida cruda: la evidencia son hechos/conteos.
 */
export type VerificationSpec = {
  // resumen/análisis: puntos clave (derivados de la tarea/fuente) que DEBEN cubrirse.
  mustCoverKeyPoints?: string[];
  minCoveredRatio?: number; // por defecto 1.0 (todos)
  // informe/documento: secciones requeridas.
  requiredSections?: string[];
  // extracción/listado estructurado: formato + campos + mínimo de items.
  format?: "json" | "csv";
  requiredFields?: string[];
  minItems?: number;
  // comentario/actualización interna: entidades/ids que DEBEN referenciarse.
  mustReference?: string[];
  // común: cadenas prohibidas (además de los marcadores de error/negativa).
  mustNotContain?: string[];
};

export type VerifyInput = { taskType?: string | null; output: string; spec?: VerificationSpec | null };
export type VerifyResult = { ok: boolean; verified: boolean; verifierType: string; evidence: any };

const unverifiable = (verifierType: string, reason: string): VerifyResult => ({ ok: true, verified: false, verifierType, evidence: { reason } });
const objFail = (verifierType: string, evidence: any): VerifyResult => ({ ok: false, verified: true, verifierType, evidence });
const objOk = (verifierType: string, evidence: any): VerifyResult => ({ ok: true, verified: true, verifierType, evidence });

/** Normaliza para comparación robusta: minúsculas, sin acentos, sin puntuación, espacios. */
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Marcadores de NEGATIVA/ERROR: si aparecen, el resultado NO resolvió la tarea. */
const ERROR_MARKERS = /\b(no puedo|no soy capaz|no dispongo|no tengo acceso|lo siento[, ]|como (una )?ia|as an ai|i (cannot|can'?t|am unable)|i'?m sorry|no se pudo|error:|excepci[oó]n|failed to|traceback|undefined is not)\b/i;

function hasErrorMarker(output: string): boolean {
  return ERROR_MARKERS.test(output);
}

/** ¿Está "cubierto" un punto clave? ≥70% de sus palabras significativas aparecen en la salida. */
function pointCovered(nOutput: string, point: string): boolean {
  const words = norm(point).split(" ").filter((w) => w.length > 3);
  if (words.length === 0) return norm(point).length > 0 && nOutput.includes(norm(point));
  const hit = words.filter((w) => nOutput.includes(w)).length;
  return hit / words.length >= 0.7;
}

function verifySummary(output: string, spec?: VerificationSpec | null): VerifyResult {
  const t = "summary";
  if (hasErrorMarker(output)) return objFail(t, { reason: "refusal_or_error" });
  const points = spec?.mustCoverKeyPoints ?? [];
  if (points.length === 0) return unverifiable(t, "sin puntos clave que verificar");
  const nOut = norm(output);
  const covered = points.filter((p) => pointCovered(nOut, p)).length;
  const ratio = covered / points.length;
  const need = spec?.minCoveredRatio ?? 1.0;
  const ev = { coveredPoints: covered, requiredPoints: points.length, ratio: Math.round(ratio * 100) / 100, need };
  return ratio >= need ? objOk(t, ev) : objFail(t, ev);
}

function verifyReport(output: string, spec?: VerificationSpec | null): VerifyResult {
  const t = "report";
  if (hasErrorMarker(output)) return objFail(t, { reason: "refusal_or_error" });
  const sections = spec?.requiredSections ?? [];
  if (sections.length === 0) return unverifiable(t, "sin secciones requeridas");
  const nOut = norm(output);
  const missing: string[] = [];
  for (const s of sections) {
    const ns = norm(s);
    // La sección debe estar presente Y tener contenido tras su título.
    const idx = nOut.indexOf(ns);
    const hasContentAfter = idx >= 0 && nOut.slice(idx + ns.length).trim().length > 0;
    if (!hasContentAfter) missing.push(s);
  }
  const ev = { requiredSections: sections.length, presentSections: sections.length - missing.length, missing: missing.length };
  return missing.length === 0 ? objOk(t, ev) : objFail(t, ev);
}

/** Extrae el primer bloque JSON del texto (por si viene envuelto en prosa/```). */
function extractJson(output: string): any {
  const fence = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : output;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("sin JSON");
  return JSON.parse(candidate.slice(start));
}

function verifyStructured(output: string, spec?: VerificationSpec | null): VerifyResult {
  const t = "structured";
  if (hasErrorMarker(output)) return objFail(t, { reason: "refusal_or_error" });
  if (!spec?.format) return unverifiable(t, "sin formato/esquema que verificar");
  const requiredFields = spec.requiredFields ?? [];
  const minItems = spec.minItems ?? 1;
  let items: any[] = [];
  try {
    if (spec.format === "json") {
      const parsed = extractJson(output);
      items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [parsed];
    } else {
      // CSV: cabecera + filas; cada fila un objeto por columna.
      const lines = output.trim().split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return objFail(t, { reason: "csv_sin_filas" });
      const headers = lines[0].split(",").map((h) => h.trim());
      items = lines.slice(1).map((l) => {
        const cells = l.split(",");
        const o: Record<string, string> = {};
        headers.forEach((h, i) => (o[h] = (cells[i] ?? "").trim()));
        return o;
      });
    }
  } catch (e: any) {
    return objFail(t, { reason: "no_parseable", detail: String(e?.message ?? e).slice(0, 40) });
  }
  if (items.length < minItems) return objFail(t, { reason: "pocos_items", items: items.length, minItems });
  // Cada item debe tener los campos requeridos con valor no vacío.
  let badItems = 0;
  for (const it of items) {
    const okFields = requiredFields.every((f) => it != null && it[f] != null && String(it[f]).trim() !== "");
    if (!okFields) badItems++;
  }
  const ev = { items: items.length, minItems, requiredFields: requiredFields.length, badItems };
  return badItems === 0 ? objOk(t, ev) : objFail(t, ev);
}

function verifyComment(output: string, spec?: VerificationSpec | null): VerifyResult {
  const t = "comment";
  if (hasErrorMarker(output)) return objFail(t, { reason: "refusal_or_error" });
  const refs = spec?.mustReference ?? [];
  if (refs.length === 0) return unverifiable(t, "sin referencias obligatorias");
  const nOut = norm(output);
  const missing = refs.filter((r) => !nOut.includes(norm(r)));
  const ev = { requiredRefs: refs.length, presentRefs: refs.length - missing.length, missing: missing.length };
  return missing.length === 0 ? objOk(t, ev) : objFail(t, ev);
}

/** Punto de entrada: aplica `mustNotContain` común y despacha por tipo de tarea. */
export function verifyResult(input: VerifyInput): VerifyResult {
  const output = input.output ?? "";
  const type = norm(input.taskType ?? "");
  // Prohibiciones comunes (objetivas) antes que nada.
  const banned = (input.spec?.mustNotContain ?? []).filter((b) => norm(output).includes(norm(b)));
  if (banned.length > 0) return objFail("guard", { reason: "contiene_prohibido", count: banned.length });

  if (/(summary|resumen|analisis|analysis)/.test(type)) return verifySummary(output, input.spec);
  if (/(report|informe|document|documento)/.test(type)) return verifyReport(output, input.spec);
  if (/(extracc|extract|listado|listing|structured|estructurad)/.test(type)) return verifyStructured(output, input.spec);
  if (/(comment|comentario|update|actualizac|nota|note)/.test(type)) return verifyComment(output, input.spec);
  // Tipo sin verificación objetiva segura → no se aprende el éxito.
  return unverifiable("none", "tipo sin verificador objetivo");
}
