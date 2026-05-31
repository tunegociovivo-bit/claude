/**
 * Visibilidad de las secciones "gated" de Bubui (Descubre y Mapa).
 *
 * Por defecto se desbloquean solas cuando hay >= MIN_BUSINESSES comercios
 * activos. Pero el admin puede forzar su activación (o desactivación) desde el
 * panel sin esperar a ese umbral. El override se guarda en BubuiSetting.
 *
 * Estado por sección:
 *   "auto" → según el umbral de comercios (comportamiento por defecto)
 *   "on"   → siempre visible (forzado por admin)
 *   "off"  → siempre oculta (forzado por admin)
 */
import { prisma } from "@/lib/db/prisma";

export const MIN_BUSINESSES = 10;
export type SectionKey = "discover" | "mapa";
export type SectionMode = "auto" | "on" | "off";

const KEY = "section_overrides";

async function getOverrides(): Promise<Record<SectionKey, SectionMode>> {
  const def: Record<SectionKey, SectionMode> = { discover: "auto", mapa: "auto" };
  const row = await prisma.bubuiSetting.findUnique({ where: { key: KEY } });
  if (!row) return def;
  try {
    const v = JSON.parse(row.value);
    return {
      discover: v.discover === "on" || v.discover === "off" ? v.discover : "auto",
      mapa: v.mapa === "on" || v.mapa === "off" ? v.mapa : "auto"
    };
  } catch {
    return def;
  }
}

async function setOverrides(o: Partial<Record<SectionKey, SectionMode>>): Promise<Record<SectionKey, SectionMode>> {
  const current = await getOverrides();
  const next = { ...current, ...o };
  await prisma.bubuiSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) }
  });
  return next;
}

/** Flags resueltos (visible sí/no) + el modo crudo, para la app y el admin. */
export async function getSectionVisibility(): Promise<{
  businesses: number;
  discover: boolean;
  mapa: boolean;
  modes: Record<SectionKey, SectionMode>;
}> {
  const [businesses, modes] = await Promise.all([
    prisma.bubuiBusiness.count({ where: { active: true } }),
    getOverrides()
  ]);
  const resolve = (mode: SectionMode) => (mode === "on" ? true : mode === "off" ? false : businesses >= MIN_BUSINESSES);
  return { businesses, discover: resolve(modes.discover), mapa: resolve(modes.mapa), modes };
}

export { getOverrides, setOverrides };
