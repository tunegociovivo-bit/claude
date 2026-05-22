/** Utilidades compartidas del importador (clientes y facturas). */

/** Normaliza para comparar: minúsculas, sin tildes, sin puntuación. */
export function norm(s: string): string {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Normaliza un NIF/CIF para comparar (sin espacios ni guiones, mayúsculas). */
export function normTaxId(s?: string | null): string {
  return (s ?? "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Empareja una cabecera de columna contra una lista de alias. Devuelve
 * true si la cabecera normalizada coincide o contiene algún alias.
 */
export function headerMatches(header: string, aliases: string[]): boolean {
  const h = norm(header);
  if (!h) return false;
  return aliases.some((a) => {
    const na = norm(a);
    return h === na || h.includes(na) || na.includes(h);
  });
}

/**
 * Detecta, para un conjunto de cabeceras, qué índice corresponde a cada
 * campo canónico según su mapa de alias. Devuelve { campo: index }.
 */
export function detectColumns(
  headers: string[],
  aliasMap: Record<string, string[]>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(aliasMap)) {
    const idx = headers.findIndex((h) => headerMatches(h, aliases));
    if (idx >= 0 && !(field in out)) out[field] = idx;
  }
  return out;
}

/**
 * Convierte un importe en texto a céntimos enteros. Soporta formato
 * español ("1.234,56 €"), inglés ("1,234.56") y simples ("1234.5").
 */
export function parseAmountToCents(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Math.round(raw * 100);
  let s = String(raw).trim().replace(/[€$\s]/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // El último separador es el decimal.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Coma como decimal (formato español).
    s = s.replace(",", ".");
  }
  const n = Number(s);
  if (isNaN(n)) return null;
  return Math.round(n * 100);
}

/** Parsea una fecha en formatos comunes (dd/mm/yyyy, yyyy-mm-dd, etc.). */
export function parseDateFlexible(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  const s = String(raw).trim();
  if (!s) return null;
  // dd/mm/yyyy o dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    const year = y.length === 2 ? Number(`20${y}`) : Number(y);
    const dt = new Date(year, Number(mo) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

export function pickRate(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 21;
  const n = Number(String(raw).replace(/[%\s]/g, "").replace(",", "."));
  if (isNaN(n)) return 21;
  return n;
}
