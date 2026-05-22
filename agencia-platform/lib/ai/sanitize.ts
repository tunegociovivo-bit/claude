/**
 * Saneado de cadenas antes de enviarlas a la API de Anthropic.
 *
 * El body se serializa a JSON; si una cadena contiene un "surrogate" UTF-16
 * suelto (un alto sin su bajo, o un bajo sin su alto) — típico de cortar un
 * emoji por la mitad con .slice(), o de datos externos con texto roto — la
 * API responde 400 "no low surrogate in string". Reemplazamos esos
 * surrogates sueltos por el carácter de reemplazo (�) para que el JSON sea
 * siempre válido sin perder el resto del contenido.
 */

export function stripLoneSurrogates(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "�") // alto sin bajo
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�"); // bajo sin alto
}

/** Aplica stripLoneSurrogates a TODAS las cadenas de una estructura. */
export function deepSanitizeStrings<T>(value: T): T {
  if (typeof value === "string") return stripLoneSurrogates(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepSanitizeStrings(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) {
      out[k] = deepSanitizeStrings((value as Record<string, unknown>)[k]);
    }
    return out as unknown as T;
  }
  return value;
}
