/**
 * Verificadores de dominio OBJETIVOS para los A0/A1 habituales de Sonia. Deciden si una
 * tarea quedó REALMENTE resuelta (nunca por longitud/no-vacío), con criterios de aceptación
 * derivados de la tarea. Alimentan el aprendizaje durable, así que son CONSERVADORES:
 *
 *  - `verified:true` SOLO en resultados objetivamente inequívocos (éxito o fallo). Un
 *    éxito manufacturable por "parroting"/eco NO se marca verificado.
 *  - Estados intermedios/ambiguos (falta de cobertura, sección sin contenido, referencia
 *    ausente) → `verified:false` (se reintenta pero NO se aprende, para no penalizar por
 *    sinónimos/redacción).
 *  - Evidencia = hechos/conteos; NUNCA el texto de salida crudo.
 * Puro y determinista.
 */
export type VerificationSpec = {
  // resumen/análisis: puntos clave a cubrir + (opcional) longitud de la fuente para exigir compresión.
  mustCoverKeyPoints?: string[];
  minCoveredRatio?: number; // por defecto 1.0
  sourceLength?: number; // si se aporta, se exige compresión (evita devolver la fuente literal)
  sourceMaxRatio?: number; // por defecto 0.6
  // informe/documento: secciones requeridas (cada una debe tener CONTENIDO propio).
  requiredSections?: string[];
  // extracción/listado estructurado: formato + campos + mínimo de items.
  format?: "json" | "csv";
  requiredFields?: string[];
  minItems?: number;
  // comentario/actualización interna: entidades/ids que DEBEN referenciarse.
  mustReference?: string[];
  // común: cadenas prohibidas.
  mustNotContain?: string[];
};

export type VerifyInput = { taskType?: string | null; output: string; spec?: VerificationSpec | null };
export type VerifyResult = { ok: boolean; verified: boolean; verifierType: string; evidence: any };

// verified:false, ok:true → completa pero NO aprende (sin criterio objetivo seguro).
const unverifiable = (verifierType: string, reason: string): VerifyResult => ({ ok: true, verified: false, verifierType, evidence: { reason } });
// verified:false, ok:false → reintenta pero NO aprende (posible falso negativo por redacción/sinónimos).
const softFail = (verifierType: string, evidence: any): VerifyResult => ({ ok: false, verified: false, verifierType, evidence });
// verified:true → objetivamente inequívoco.
const objFail = (verifierType: string, evidence: any): VerifyResult => ({ ok: false, verified: true, verifierType, evidence });
const objOk = (verifierType: string, evidence: any): VerifyResult => ({ ok: true, verified: true, verifierType, evidence });

/** Normaliza: minúsculas, sin acentos, sin puntuación, espacios colapsados. */
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const contentWords = (nText: string): string[] => nText.split(" ").filter((w) => w.length > 3);

// SOLO frases de NEGATIVA del modelo (no "error:"/"traceback"/… que son legítimos en informes).
const REFUSAL = /\b(no puedo|no soy capaz|no me es posible|no dispongo|no tengo acceso|lo siento[, ]|como (una )?ia|as an ai|i (cannot|can'?t|am unable)|i'?m sorry|unable to (help|assist|comply))\b/i;
/** ¿La SALIDA es una negativa? Solo si ENCABEZA (primeros ~48 chars): así una negativa
 *  real ("Lo siento, no puedo…") se detecta, pero un informe/resumen que CITE una negativa
 *  dentro del contenido no se marca como fallo por ello (evita falsos negativos). */
function isRefusal(output: string): boolean {
  return REFUSAL.test((output || "").slice(0, 48));
}

/** Cobertura por PALABRA EXACTA (no substring): ≥70% de las palabras significativas del punto. */
function pointCovered(outWordSet: Set<string>, point: string): boolean {
  const words = norm(point).split(" ").filter((w) => w.length > 3);
  if (words.length === 0) {
    const np = norm(point);
    return np.length > 0 && outWordSet.has(np); // punto muy corto → token exacto
  }
  const hit = words.filter((w) => outWordSet.has(w)).length;
  return hit / words.length >= 0.7;
}

function verifySummary(output: string, spec?: VerificationSpec | null): VerifyResult {
  const t = "summary";
  if (isRefusal(output)) return objFail(t, { reason: "refusal" });
  const points = spec?.mustCoverKeyPoints ?? [];
  if (points.length === 0) return unverifiable(t, "sin puntos clave que verificar");
  const nOut = norm(output);
  const outWords = new Set(nOut.split(" "));
  const covered = points.filter((p) => pointCovered(outWords, p)).length;
  const need = Math.min(1, Math.max(0.01, spec?.minCoveredRatio ?? 1.0));
  const ratio = covered / points.length;
  if (ratio < need) return softFail(t, { coveredPoints: covered, requiredPoints: points.length, ratio: Math.round(ratio * 100) / 100 });
  // Anti-eco: el resumen debe tener contenido SUSTANCIAL más allá de las palabras clave.
  const keyWords = new Set(points.flatMap((p) => norm(p).split(" ").filter((w) => w.length > 3)));
  const nonKey = contentWords(nOut).filter((w) => !keyWords.has(w)).length;
  if (nonKey < Math.max(8, keyWords.size * 2)) return unverifiable(t, "posible eco de puntos clave (contenido insuficiente)");
  // Compresión (si se aporta la longitud de la fuente): evita devolver la fuente literal.
  if (typeof spec?.sourceLength === "number" && spec.sourceLength > 0) {
    const maxRatio = spec.sourceMaxRatio ?? 0.6;
    if (output.length > maxRatio * spec.sourceLength) return unverifiable(t, "sin compresión suficiente frente a la fuente");
  }
  return objOk(t, { coveredPoints: covered, requiredPoints: points.length, nonKeyContentWords: nonKey });
}

function verifyReport(output: string, spec?: VerificationSpec | null): VerifyResult {
  const t = "report";
  if (isRefusal(output)) return objFail(t, { reason: "refusal" });
  const sections = spec?.requiredSections ?? [];
  if (sections.length === 0) return unverifiable(t, "sin secciones requeridas");
  const nOut = norm(output);
  // Localiza cada sección; deben existir todas.
  const located = sections.map((s) => ({ s, ns: norm(s), idx: nOut.indexOf(norm(s)) }));
  const missing = located.filter((l) => l.idx < 0);
  if (missing.length > 0) return softFail(t, { requiredSections: sections.length, missing: missing.length });
  // CONTENIDO propio de cada sección: entre su título y el inicio de la siguiente sección.
  const ordered = [...located].sort((a, b) => a.idx - b.idx);
  let thin = 0;
  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i].idx + ordered[i].ns.length;
    const end = i + 1 < ordered.length ? ordered[i + 1].idx : nOut.length;
    const body = nOut.slice(start, end).trim();
    if (contentWords(body).length < 3) thin++; // título sin contenido propio (p.ej. lista de headings)
  }
  const ev = { requiredSections: sections.length, sectionsWithContent: sections.length - thin, thin };
  return thin === 0 ? objOk(t, ev) : softFail(t, ev);
}

/** Extrae el primer bloque JSON (por si viene envuelto en prosa o ``` ). */
function extractJson(output: string): any {
  const fence = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : output;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("sin json");
  return JSON.parse(candidate.slice(start));
}

function verifyStructured(output: string, spec?: VerificationSpec | null): VerifyResult {
  const t = "structured";
  if (isRefusal(output)) return objFail(t, { reason: "refusal" });
  if (!spec?.format) return unverifiable(t, "sin formato/esquema que verificar");
  const requiredFields = spec.requiredFields ?? [];
  const minItems = Math.max(1, Math.floor(Number(spec.minItems) || 1)); // un resultado vacío nunca resuelve
  let items: any[] = [];
  try {
    if (spec.format === "json") {
      const parsed = extractJson(output);
      items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [parsed];
    } else {
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
  } catch {
    return objFail(t, { reason: "no_parseable" }); // sin fragmento del output crudo
  }
  if (items.length < minItems) return objFail(t, { reason: "pocos_items", items: items.length, minItems });
  let badItems = 0;
  for (const it of items) {
    const isObj = it != null && typeof it === "object" && !Array.isArray(it);
    if (!isObj) { badItems++; continue; } // primitivos/arrays no son items válidos
    if (requiredFields.length > 0) {
      const okFields = requiredFields.every((f) => it[f] != null && String(it[f]).trim() !== "");
      if (!okFields) badItems++;
    } else if (Object.keys(it).length === 0) {
      badItems++; // objeto vacío no es un item válido
    }
  }
  const ev = { items: items.length, minItems, requiredFields: requiredFields.length, badItems };
  return badItems === 0 ? objOk(t, ev) : objFail(t, ev);
}

function verifyComment(output: string, spec?: VerificationSpec | null): VerifyResult {
  const t = "comment";
  if (isRefusal(output)) return objFail(t, { reason: "refusal" });
  const refs = spec?.mustReference ?? [];
  if (refs.length === 0) return unverifiable(t, "sin referencias obligatorias");
  const nOut = norm(output);
  // Referencia por token exacto (no substring incidental).
  const outWords = new Set(nOut.split(" "));
  const present = (ref: string): boolean => {
    const nr = norm(ref);
    const rw = nr.split(" ").filter((w) => w.length > 0);
    return rw.every((w) => outWords.has(w)); // todas las palabras del identificador presentes
  };
  const missing = refs.filter((r) => !present(r));
  const ev = { requiredRefs: refs.length, presentRefs: refs.length - missing.length, missing: missing.length };
  return missing.length === 0 ? objOk(t, ev) : softFail(t, ev);
}

/** Punto de entrada: prohibiciones comunes + despacho por tipo de tarea. */
export function verifyResult(input: VerifyInput): VerifyResult {
  const output = input.output ?? "";
  const type = norm(input.taskType ?? "");
  const banned = (input.spec?.mustNotContain ?? []).filter((b) => norm(output).includes(norm(b)));
  if (banned.length > 0) return objFail("guard", { reason: "contiene_prohibido", count: banned.length });

  if (/(summary|resumen|analisis|analysis)/.test(type)) return verifySummary(output, input.spec);
  if (/(report|informe|document|documento)/.test(type)) return verifyReport(output, input.spec);
  if (/(extracc|extract|listado|listing|structured|estructurad)/.test(type)) return verifyStructured(output, input.spec);
  if (/(comment|comentario|update|actualizac|nota|note)/.test(type)) return verifyComment(output, input.spec);
  return unverifiable("none", "tipo sin verificador objetivo");
}
