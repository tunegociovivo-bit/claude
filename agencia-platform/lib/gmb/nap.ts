/**
 * NAP (Name/Address/Phone + Web) — normalización y comparación para el Citation Engine.
 *
 * La consistencia del NAP en directorios locales es un factor SEO local clave. Aquí normalizamos
 * cada campo de forma tolerante (acentos, mayúsculas, formas jurídicas, abreviaturas de vía,
 * prefijos de teléfono, www/protocolo) y comparamos el NAP canónico de la ficha contra el
 * observado en un directorio, devolviendo qué campos DIFIEREN. Puro y determinista (testeable).
 */

export type Nap = { name?: string | null; address?: string | null; phone?: string | null; website?: string | null };
export type NapDiff = { name: boolean; address: boolean; phone: boolean; website: boolean };

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Nombre comercial: minúsculas, sin acentos, sin forma jurídica ni puntuación, espacios colapsados. */
export function normalizeName(v?: string | null): string {
  if (!v) return "";
  let s = stripAccents(String(v)).toLowerCase();
  s = s.replace(/[.,;:"'()]/g, " ");
  // Formas jurídicas españolas comunes (como palabra suelta).
  s = s.replace(/\b(s\s*\.?\s*l\s*\.?\s*u?|s\s*\.?\s*a\s*\.?|s\s*\.?\s*c\s*\.?|c\s*\.?\s*b\s*\.?|sll|slu|sociedad limitada|sociedad anonima)\b/g, " ");
  s = s.replace(/&/g, " y ");
  return s.replace(/\s+/g, " ").trim();
}

const STREET_ABBR: [RegExp, string][] = [
  [/\bc\/?\b/g, "calle"], [/\bcl\b/g, "calle"], [/\bavda?\b/g, "avenida"], [/\bav\b/g, "avenida"],
  [/\bpso\b/g, "paseo"], [/\bpza\b/g, "plaza"], [/\bpl\b/g, "plaza"], [/\bctra\b/g, "carretera"],
  [/\bnum\b/g, ""], [/\bn\b/g, ""], [/\bº\b/g, ""], [/\bpol\b/g, "poligono"], [/\burb\b/g, "urbanizacion"]
];

/** Dirección: minúsculas, sin acentos, abreviaturas de vía expandidas, sin puntuación, colapsada. */
export function normalizeAddress(v?: string | null): string {
  if (!v) return "";
  let s = stripAccents(String(v)).toLowerCase().replace(/[.,;:#ºª/]/g, " ");
  for (const [re, rep] of STREET_ABBR) s = s.replace(re, rep);
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Dos direcciones son COMPATIBLES (no difieren) si, normalizadas, una contiene a la otra (p.ej. la
 * canónica añade ciudad/CP que el directorio omite) o comparten la mayoría de tokens. Evita marcar
 * inconsistencias falsas por incluir/omitir la localidad.
 */
function addressCompatible(a: string, b: string): boolean {
  if (!a || !b) return true; // uno ausente → no hay evidencia de diferencia
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const overlap = inter / Math.min(ta.size, tb.size || 1);
  return overlap >= 0.6;
}

/** Teléfono español a 9 dígitos (quita +34/34/0 y separadores). "" si no es válido. */
export function normalizePhone(v?: string | null): string {
  if (!v) return "";
  const digits = String(v).replace(/[^\d]/g, "").replace(/^0+/, "").replace(/^34(?=\d{9}$)/, "");
  return digits.length === 9 ? digits : digits; // conserva lo que haya para comparar aun si no valida
}

/** Web a host canónico (sin protocolo, sin www, sin path, minúsculas). */
export function normalizeWebsite(v?: string | null): string {
  if (!v) return "";
  try {
    return new URL(/^https?:/i.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(v).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();
  }
}

export function normalizeNap(nap: Nap): Required<Record<keyof Nap, string>> {
  return {
    name: normalizeName(nap.name),
    address: normalizeAddress(nap.address),
    phone: normalizePhone(nap.phone),
    website: normalizeWebsite(nap.website)
  };
}

/**
 * Compara el NAP canónico con el observado. Un campo DIFIERE (true) solo si AMBOS tienen valor y
 * su forma normalizada no coincide. Un campo ausente en el observado NO cuenta como diferencia
 * (no hay evidencia), para no marcar inconsistencias falsas.
 */
export function compareNap(canonical: Nap, observed: Nap): NapDiff {
  const c = normalizeNap(canonical);
  const o = normalizeNap(observed);
  const differs = (a: string, b: string) => !!a && !!b && a !== b;
  return {
    name: differs(c.name, o.name),
    address: !!c.address && !!o.address && !addressCompatible(c.address, o.address),
    phone: differs(c.phone, o.phone),
    website: differs(c.website, o.website)
  };
}

/** ¿Hay alguna inconsistencia observable (algún campo comparado difiere)? */
export function hasNapInconsistency(diff: NapDiff): boolean {
  return diff.name || diff.address || diff.phone || diff.website;
}
