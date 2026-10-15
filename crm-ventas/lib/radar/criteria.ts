// Condiciones de una búsqueda guardada y la comprobación de si un coche las
// cumple. Funciones puras (se prueban en tests/radar-*.test.ts y se usan en el
// servidor y en la vista previa del editor).
import { z } from "zod";
import { FUELS, GEARBOXES, fold, makeKey, type Fuel, type Gearbox } from "./normalize";

const intOrNull = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d]/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  });

const textList = (max: number) =>
  z
    .array(z.string().max(60))
    .max(max)
    .optional()
    .transform((list) => [...new Set((list ?? []).map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean))]);

export const criteriaSchema = z
  .object({
    makes: textList(30),
    models: textList(40),
    keywords: textList(10),
    excludeKeywords: textList(20),
    yearMin: intOrNull,
    yearMax: intOrNull,
    kmMin: intOrNull,
    kmMax: intOrNull,
    priceMin: intOrNull,
    priceMax: intOrNull,
    powerMinCv: intOrNull,
    fuels: z.array(z.enum(FUELS)).max(FUELS.length).optional().transform((v) => [...new Set(v ?? [])]),
    gearboxes: z.array(z.enum(GEARBOXES)).max(2).optional().transform((v) => [...new Set(v ?? [])]),
    countries: z
      .array(z.string().regex(/^[A-Za-z]{2}$/))
      .max(40)
      .optional()
      .transform((v) => [...new Set((v ?? []).map((c) => c.toUpperCase()))]),
    portals: z.array(z.string().max(30)).max(30).optional().transform((v) => [...new Set(v ?? [])]),
    // Si un coche no trae un dato que la búsqueda filtra (p. ej. sin km), ¿avisar igualmente?
    includeUnknown: z.boolean().optional().default(false),
  })
  .strip();

export type RadarCriteria = z.output<typeof criteriaSchema>;

export function parseCriteria(value: unknown): RadarCriteria {
  const parsed = criteriaSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : criteriaSchema.parse({});
}

/** Comprobaciones de coherencia que se enseñan al guardar. */
export function criteriaErrors(c: RadarCriteria): string[] {
  const errors: string[] = [];
  if (c.yearMin && c.yearMax && c.yearMin > c.yearMax) errors.push("El año mínimo es mayor que el máximo.");
  if (c.kmMin !== null && c.kmMax !== null && c.kmMin > c.kmMax) errors.push("Los km mínimos son mayores que los máximos.");
  if (c.priceMin !== null && c.priceMax !== null && c.priceMin > c.priceMax) errors.push("El precio mínimo es mayor que el máximo.");
  const now = new Date().getFullYear() + 1;
  for (const y of [c.yearMin, c.yearMax]) if (y !== null && (y < 1950 || y > now)) errors.push(`El año ${y} no es válido.`);
  const hasAny =
    c.makes.length || c.models.length || c.keywords.length || c.yearMin || c.yearMax || c.kmMax !== null ||
    c.priceMax !== null || c.fuels.length || c.gearboxes.length || c.powerMinCv;
  if (!hasAny) errors.push("Pon al menos una condición (marca, modelo, precio, km, año…): sin ninguna avisaría de todos los coches.");
  return errors;
}

export type MatchableListing = {
  portal: string;
  title: string;
  make: string | null;
  model: string | null;
  version: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  fuel: string | null;
  gearbox: string | null;
  powerCv: number | null;
  country: string | null;
};

function haystack(l: MatchableListing): string {
  return ` ${fold([l.make, l.model, l.version, l.title].filter(Boolean).join(" "))} `;
}

// `hay` va rodeado de espacios y con palabras separadas por un espacio, así que
// ` needle ` casa la palabra (o frase) completa: «1» no casa dentro de «118d».
function containsWord(hay: string, needle: string): boolean {
  const n = fold(needle);
  if (!n) return true;
  return hay.includes(` ${n} `);
}

function inRange(value: number | null, min: number | null, max: number | null, includeUnknown: boolean): boolean {
  if (min === null && max === null) return true;
  if (value === null) return includeUnknown;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

/** ¿El coche cumple la búsqueda? Devuelve el motivo del primer fallo (para depurar). */
export function checkListing(l: MatchableListing, c: RadarCriteria): { ok: true } | { ok: false; reason: string } {
  if (c.portals.length && !c.portals.includes(l.portal)) return { ok: false, reason: "portal" };
  const hay = haystack(l);

  if (c.makes.length) {
    const key = makeKey(l.make);
    const okMake = c.makes.some((m) => {
      const mk = makeKey(m);
      return key ? key === mk : containsWord(hay, mk);
    });
    if (!okMake) return { ok: false, reason: "marca" };
  }
  if (c.models.length) {
    // «Serie 3», «X1», «Golf»: se buscan como palabra/frase en marca+modelo+versión+título.
    const okModel = c.models.some((m) => containsWord(hay, m));
    if (!okModel) return { ok: false, reason: "modelo" };
  }
  for (const k of c.keywords) if (!containsWord(hay, k)) return { ok: false, reason: "palabras" };
  for (const k of c.excludeKeywords) if (containsWord(hay, k)) return { ok: false, reason: "excluidas" };

  if (!inRange(l.year, c.yearMin, c.yearMax, c.includeUnknown)) return { ok: false, reason: "año" };
  if (!inRange(l.km, c.kmMin, c.kmMax, c.includeUnknown)) return { ok: false, reason: "km" };
  if (!inRange(l.price, c.priceMin, c.priceMax, c.includeUnknown)) return { ok: false, reason: "precio" };
  if (!inRange(l.powerCv, c.powerMinCv, null, c.includeUnknown)) return { ok: false, reason: "potencia" };

  if (c.fuels.length) {
    if (!l.fuel) {
      if (!c.includeUnknown) return { ok: false, reason: "combustible" };
    } else if (!c.fuels.includes(l.fuel as Fuel)) {
      // Un híbrido enchufable también es «híbrido» para quien busca híbridos.
      if (!(l.fuel === "hibrido_enchufable" && c.fuels.includes("hibrido"))) return { ok: false, reason: "combustible" };
    }
  }
  if (c.gearboxes.length) {
    if (!l.gearbox) {
      if (!c.includeUnknown) return { ok: false, reason: "cambio" };
    } else if (!c.gearboxes.includes(l.gearbox as Gearbox)) return { ok: false, reason: "cambio" };
  }
  if (c.countries.length) {
    if (!l.country) {
      if (!c.includeUnknown) return { ok: false, reason: "país" };
    } else if (!c.countries.includes(l.country.toUpperCase())) return { ok: false, reason: "país" };
  }
  return { ok: true };
}

export function matchesCriteria(l: MatchableListing, c: RadarCriteria): boolean {
  return checkListing(l, c).ok;
}

/** Resumen corto de una búsqueda para listas y avisos («BMW X1 · ≤ 20.000 € · ≤ 80.000 km»). */
export function describeCriteria(c: RadarCriteria): string {
  const parts: string[] = [];
  const what = [c.makes.join("/"), c.models.join("/")].filter(Boolean).join(" ");
  if (what) parts.push(what);
  if (c.keywords.length) parts.push(`«${c.keywords.join(" ")}»`);
  if (c.yearMin || c.yearMax) parts.push(c.yearMin && c.yearMax ? `${c.yearMin}–${c.yearMax}` : c.yearMin ? `desde ${c.yearMin}` : `hasta ${c.yearMax}`);
  const n = (v: number) => new Intl.NumberFormat("es-ES").format(v);
  if (c.kmMax !== null) parts.push(`≤ ${n(c.kmMax)} km`);
  if (c.priceMin !== null && c.priceMax !== null) parts.push(`${n(c.priceMin)}–${n(c.priceMax)} €`);
  else if (c.priceMax !== null) parts.push(`≤ ${n(c.priceMax)} €`);
  else if (c.priceMin !== null) parts.push(`≥ ${n(c.priceMin)} €`);
  if (c.fuels.length) parts.push(c.fuels.join("/"));
  if (c.gearboxes.length) parts.push(c.gearboxes.join("/"));
  if (c.powerMinCv) parts.push(`≥ ${c.powerMinCv} CV`);
  if (c.countries.length) parts.push(c.countries.join(","));
  return parts.join(" · ") || "Sin condiciones";
}
