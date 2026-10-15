// Normalización de los datos de coches que llegan de cada portal (cada uno los
// da en su idioma y formato). Sin dependencias de servidor: se usa también en
// los tests y en el cliente (formatos).
import { madridWallTime } from "@/lib/inbox/time";

export const FUELS = ["diesel", "gasolina", "hibrido", "hibrido_enchufable", "electrico", "glp", "gnc", "otro"] as const;
export type Fuel = (typeof FUELS)[number];
export const FUEL_LABELS: Record<Fuel, string> = {
  diesel: "Diésel",
  gasolina: "Gasolina",
  hibrido: "Híbrido",
  hibrido_enchufable: "Híbrido enchufable",
  electrico: "Eléctrico",
  glp: "GLP",
  gnc: "GNC",
  otro: "Otro",
};

export const GEARBOXES = ["manual", "automatico"] as const;
export type Gearbox = (typeof GEARBOXES)[number];
export const GEARBOX_LABELS: Record<Gearbox, string> = { manual: "Manual", automatico: "Automático" };

/** Minúsculas, sin acentos, sin signos: para comparar textos de distintos portales. */
export function fold(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Marcas con varios nombres según el portal.
const MAKE_ALIASES: Record<string, string> = {
  "mercedes": "mercedes benz",
  "mercedes benz": "mercedes benz",
  "mb": "mercedes benz",
  "vw": "volkswagen",
  "volkswagen": "volkswagen",
  "land rover": "land rover",
  "landrover": "land rover",
  "range rover": "land rover",
  "alfa": "alfa romeo",
  "alfa romeo": "alfa romeo",
  "citroen": "citroen",
  "ds": "ds",
  "ds automobiles": "ds",
  "mini": "mini",
  "bmw mini": "mini",
  "seat": "seat",
  "cupra": "cupra",
  "skoda": "skoda",
  "ssangyong": "ssangyong",
  "kg mobility": "ssangyong",
  "rolls royce": "rolls royce",
  "aston martin": "aston martin",
  "lynk co": "lynk co",
  "lynk": "lynk co",
};

/** Clave canónica de una marca («Mercedes-Benz», «MERCEDES» → «mercedes benz»). */
export function makeKey(value: unknown): string {
  const f = fold(value);
  if (!f) return "";
  return MAKE_ALIASES[f] ?? f;
}

/** Entero a partir de «45.000 km», «12.500,00 €», 45000, «45 000». */
export function parseInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const key of ["value", "amount", "amountInEuro", "valueInEuro", "number", "raw"]) {
      if (key in v) return parseInteger(v[key]);
    }
    return null;
  }
  let s = String(value).trim();
  if (!s) return null;
  // Decimales europeos («12.500,50») y anglosajones («12,500.50»): se quita la
  // parte decimal y los separadores de miles.
  s = s.replace(/[^\d.,-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decimalSep = lastComma > lastDot ? "," : ".";
  const decimalIdx = decimalSep === "," ? lastComma : lastDot;
  if (decimalIdx >= 0) {
    const decimals = s.slice(decimalIdx + 1);
    // Con 1-2 cifras detrás es parte decimal; con 3 es separador de miles.
    if (decimals.length > 0 && decimals.length <= 2) s = s.slice(0, decimalIdx);
  }
  const n = Number(s.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Año a partir de 2019, «2019», «03/2019», «2019-03-01», fecha ISO o timestamp. */
export function parseYear(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const now = new Date().getFullYear() + 1;
  if (typeof value === "number") {
    if (value >= 1950 && value <= now) return value;
    if (value > 1e11) return parseYear(new Date(value).toISOString()); // ms
    if (value > 1e8) return parseYear(new Date(value * 1000).toISOString()); // s
    return null;
  }
  const s = String(value);
  const m = s.match(/\b(19[5-9]\d|20\d\d)\b/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1950 && y <= now ? y : null;
}

export function normalizeFuel(value: unknown): Fuel | null {
  const f = fold(value);
  if (!f) return null;
  if (/plug|enchuf|phev|rechargeable|plugin|plug in/.test(f)) return "hibrido_enchufable";
  if (/hybr|hibrid|hev|mhev|mild/.test(f)) return "hibrido";
  if (/elect|bev|\bev\b|elektr/.test(f)) return "electrico";
  if (/diesel|gasoil|gasoleo|tdi|cdi|hdi|dci|crdi/.test(f)) return "diesel";
  if (/lpg|glp|autogas/.test(f)) return "glp";
  if (/cng|gnc|erdgas|natural gas|gnv/.test(f)) return "gnc";
  if (/gasolin|petrol|benzin|essence|gasoline|super|tsi|tfsi/.test(f)) return "gasolina";
  return "otro";
}

export function normalizeGearbox(value: unknown): Gearbox | null {
  const f = fold(value);
  if (!f) return null;
  if (/auto|dsg|cvt|tiptronic|steptronic|s tronic|edc|eat|dct|pdk/.test(f)) return "automatico";
  if (/manu|schalt|mecan/.test(f)) return "manual";
  return null;
}

const COUNTRY_NAMES: Record<string, string> = {
  espana: "ES", spain: "ES", espagne: "ES", spanien: "ES", es: "ES",
  francia: "FR", france: "FR", frankreich: "FR", fr: "FR",
  alemania: "DE", germany: "DE", deutschland: "DE", allemagne: "DE", de: "DE",
  italia: "IT", italy: "IT", italie: "IT", it: "IT",
  portugal: "PT", pt: "PT",
  belgica: "BE", belgium: "BE", belgique: "BE", be: "BE",
  "paises bajos": "NL", holanda: "NL", netherlands: "NL", "pays bas": "NL", nederland: "NL", nl: "NL",
  austria: "AT", osterreich: "AT", at: "AT",
  polonia: "PL", poland: "PL", pl: "PL",
  "reino unido": "GB", "united kingdom": "GB", uk: "GB", gb: "GB",
  suiza: "CH", switzerland: "CH", ch: "CH",
  suecia: "SE", sweden: "SE", se: "SE",
  dinamarca: "DK", denmark: "DK", dk: "DK",
  luxemburgo: "LU", luxembourg: "LU", lu: "LU",
  "republica checa": "CZ", czechia: "CZ", "czech republic": "CZ", cz: "CZ",
};

export function normalizeCountry(value: unknown): string | null {
  const f = fold(value);
  if (!f) return null;
  if (COUNTRY_NAMES[f]) return COUNTRY_NAMES[f];
  if (/^[a-z]{2}$/.test(f)) return f.toUpperCase();
  // «Madrid, España» / «Lyon (France)»
  for (const [name, code] of Object.entries(COUNTRY_NAMES)) {
    if (name.length > 2 && new RegExp(`\\b${name}\\b`).test(f)) return code;
  }
  return null;
}

/** Fecha válida o null (ISO, timestamp en s o ms). */
export function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  let d: Date;
  if (typeof value === "number") d = new Date(value > 1e11 ? value : value * 1000);
  else if (value instanceof Date) d = value;
  else {
    const s = String(value).trim();
    // dd/mm/yyyy [hh:mm]
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
    // Hora de pared española (los portales europeos muestran hora local).
    if (m) d = madridWallTime(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
    else d = new Date(s);
  }
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  const year = d.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? d : null;
}

export function cleanText(value: unknown, max = 200): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const key of ["name", "label", "value", "text", "displayName", "description", "title"]) {
      if (typeof v[key] === "string" || typeof v[key] === "number") return cleanText(v[key], max);
    }
    return null;
  }
  const s = String(value).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

export function safeHttpUrl(value: unknown, base?: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = base ? new URL(value.trim(), base) : new URL(value.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function formatEuros(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(value)} €`;
}

export function formatKm(value: number | null | undefined): string {
  if (value === null || value === undefined) return "— km";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(value)} km`;
}
