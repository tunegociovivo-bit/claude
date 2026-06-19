/**
 * Directorio SEO de Bubui: páginas por nicho + localidad
 * (bubui.app/peluquerias/benalmadena) pensadas para posicionar en Google y
 * captar negocios ("busco mi sector en mi pueblo → aparece Bubui arriba →
 * me doy de alta para salir aquí").
 *
 * El campo `category` del negocio es texto libre (viene del alta o del lead
 * de Google), así que lo normalizamos a una taxonomía canónica con slug
 * estable + etiqueta bonita. La localidad sale de `city`.
 */
import { prisma } from "@/lib/db/prisma";

/** Quita acentos, pasa a minúsculas y deja un slug limpio. */
export function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Taxonomía canónica de nichos. `match` son palabras clave (ya sin acentos)
 *  para mapear el texto libre del negocio a una de estas categorías. */
export type CategoryDef = {
  slug: string;
  /** Plural para títulos y H1: "Peluquerías". */
  label: string;
  /** Singular para frases: "peluquería". */
  singular: string;
  match: string[];
};

export const CATEGORY_TAXONOMY: CategoryDef[] = [
  { slug: "restaurantes", label: "Restaurantes", singular: "restaurante", match: ["restaur", "comida", "food", "mariscder", "asador", "pizzer", "taper", "tapas"] },
  { slug: "cafes-y-bares", label: "Cafés y bares", singular: "café o bar", match: ["cafe", "café", "bar", "cafeter", "pub", "cervec", "coffee"] },
  { slug: "peluquerias", label: "Peluquerías y barberías", singular: "peluquería", match: ["peluquer", "barber", "barbería", "hair"] },
  { slug: "estetica-y-spa", label: "Centros de estética y spa", singular: "centro de estética", match: ["estetic", "estética", "spa", "belleza", "beauty", "uñas", "unas", "manicur", "depilac"] },
  { slug: "gimnasios", label: "Gimnasios y centros fitness", singular: "gimnasio", match: ["gimnas", "gym", "fitness", "crossfit", "pilates", "yoga"] },
  { slug: "nutricion-y-salud", label: "Nutrición y salud", singular: "centro de salud", match: ["nutric", "diet", "salud", "health", "clinic", "fisio", "podolog", "dental", "psicolog"] },
  { slug: "moda", label: "Tiendas de moda", singular: "tienda de moda", match: ["moda", "ropa", "fashion", "boutique", "calzado", "zapat", "complement"] },
  { slug: "regalos", label: "Tiendas de regalos", singular: "tienda de regalos", match: ["regalo", "gift", "deco", "bazar"] },
  { slug: "joyerias", label: "Joyerías", singular: "joyería", match: ["joyer", "jewel", "reloj", "bisuter"] },
  { slug: "floristerias", label: "Floristerías", singular: "floristería", match: ["florist", "flores", "flower", "planta"] },
  { slug: "otros", label: "Otros negocios", singular: "negocio", match: [] }
];

const OTHERS = CATEGORY_TAXONOMY[CATEGORY_TAXONOMY.length - 1];

/** Mapa slug → definición (para resolver desde la URL). */
const BY_SLUG = new Map(CATEGORY_TAXONOMY.map((c) => [c.slug, c]));

/** Resuelve el texto libre de `category` a una categoría canónica. */
export function resolveCategory(raw: string | null | undefined): CategoryDef {
  const norm = slugify(raw || "").replace(/-/g, " ");
  for (const c of CATEGORY_TAXONOMY) {
    if (c.match.some((m) => norm.includes(slugify(m).replace(/-/g, " ")))) return c;
  }
  return OTHERS;
}

/** Definición a partir del slug de la URL (o null si no existe). */
export function categoryBySlug(slug: string): CategoryDef | null {
  return BY_SLUG.get(slug) ?? null;
}

export type DirectoryBusiness = {
  id: string;
  slug: string;
  name: string;
  category: string;
  city: string;
  province: string | null;
  description: string | null;
  address: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  defaultDiscountPct: number;
};

const SELECT = {
  id: true, slug: true, name: true, category: true, city: true, province: true,
  description: true, address: true, logoUrl: true, brandColor: true, defaultDiscountPct: true
} as const;

/**
 * Negocios activos de un nicho en una localidad (matching por slug, ya que
 * `category`/`city` son texto libre). A escala pequeña filtramos en memoria;
 * cuando crezca conviene columnas normalizadas + índices.
 */
export async function getListing(catSlug: string, citySlug: string): Promise<{
  category: CategoryDef;
  cityLabel: string;
  province: string | null;
  businesses: DirectoryBusiness[];
} | null> {
  const category = categoryBySlug(catSlug);
  if (!category) return null;

  const all = await prisma.bubuiBusiness.findMany({ where: { active: true }, select: SELECT });
  const businesses = all.filter(
    (b) => resolveCategory(b.category).slug === catSlug && slugify(b.city) === citySlug
  );
  if (businesses.length === 0) return null;

  // Etiqueta de ciudad/provincia a partir del primer negocio (conserva acentos).
  return {
    category,
    cityLabel: businesses[0].city,
    province: businesses[0].province,
    businesses: businesses.sort((a, b) => a.name.localeCompare(b.name))
  };
}

/** Localidades (con conteo) donde un nicho tiene negocios activos. */
export async function getLocalitiesForCategory(catSlug: string): Promise<{
  category: CategoryDef;
  localities: { citySlug: string; cityLabel: string; count: number }[];
} | null> {
  const category = categoryBySlug(catSlug);
  if (!category) return null;
  const all = await prisma.bubuiBusiness.findMany({ where: { active: true }, select: { category: true, city: true } });
  const map = new Map<string, { cityLabel: string; count: number }>();
  for (const b of all) {
    if (resolveCategory(b.category).slug !== catSlug) continue;
    const cs = slugify(b.city);
    if (!cs) continue;
    const cur = map.get(cs);
    if (cur) cur.count++;
    else map.set(cs, { cityLabel: b.city, count: 1 });
  }
  const localities = [...map.entries()]
    .map(([citySlug, v]) => ({ citySlug, ...v }))
    .sort((a, b) => b.count - a.count || a.cityLabel.localeCompare(b.cityLabel));
  if (localities.length === 0) return null;
  return { category, localities };
}

/** Todos los pares nicho×localidad con negocios (índice + sitemap). */
export async function getDirectoryIndex(): Promise<{
  pairs: { catSlug: string; catLabel: string; citySlug: string; cityLabel: string; count: number }[];
  categories: { catSlug: string; catLabel: string; count: number }[];
}> {
  const all = await prisma.bubuiBusiness.findMany({ where: { active: true }, select: { category: true, city: true } });
  const pairMap = new Map<string, { catSlug: string; catLabel: string; citySlug: string; cityLabel: string; count: number }>();
  const catMap = new Map<string, { catLabel: string; count: number }>();
  for (const b of all) {
    const cat = resolveCategory(b.category);
    const cs = slugify(b.city);
    if (!cs) continue;
    const key = `${cat.slug}/${cs}`;
    const p = pairMap.get(key);
    if (p) p.count++;
    else pairMap.set(key, { catSlug: cat.slug, catLabel: cat.label, citySlug: cs, cityLabel: b.city, count: 1 });
    const c = catMap.get(cat.slug);
    if (c) c.count++;
    else catMap.set(cat.slug, { catLabel: cat.label, count: 1 });
  }
  return {
    pairs: [...pairMap.values()].sort((a, b) => b.count - a.count),
    categories: [...catMap.entries()].map(([catSlug, v]) => ({ catSlug, ...v })).sort((a, b) => b.count - a.count)
  };
}
