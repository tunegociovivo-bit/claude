/**
 * Rankings "Los mejores {sector} de {localidad}" del directorio Bubui.
 *
 * Posiciona la consulta "mejores …" (más intención que el listado normal) y
 * sirve de gancho comercial: el negocio quiere salir arriba → consigue reseñas
 * / se da de alta / paga por destacar.
 *
 * El orden es HONESTO (clave para la confianza y el SEO): una "Puntuación
 * Bubui" 0-100 que combina la valoración de reseñas (media bayesiana, para que
 * pocas reseñas no disparen a nadie al top) con el visibilityScore. Los
 * negocios `featured` se marcan con badge "Destacado" pero NO se recolocan.
 */
import { prisma } from "@/lib/db/prisma";
import { resolveCategory, slugify, categoryBySlug, type CategoryDef } from "@/lib/bubui/directory";

/** Nº mínimo de negocios para que un ranking sea creíble (si no, 404). */
export const MIN_RANKING = 3;

const GLOBAL_MEAN = 4.3; // media de partida (prior bayesiano)
const CONFIDENCE = 5; // nº de "reseñas fantasma" en la media bayesiana

export type RankedBusiness = {
  position: number;
  id: string;
  slug: string;
  name: string;
  address: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  defaultDiscountPct: number;
  featured: boolean;
  ratingAvg: number | null; // media real (null si no hay reseñas)
  ratingCount: number;
  score: number; // Puntuación Bubui 0-100
};

export async function getRanking(catSlug: string, citySlug: string): Promise<{
  category: CategoryDef;
  cityLabel: string;
  province: string | null;
  businesses: RankedBusiness[];
} | null> {
  const category = categoryBySlug(catSlug);
  if (!category) return null;

  const all = await prisma.bubuiBusiness.findMany({
    where: { active: true },
    select: {
      id: true, slug: true, name: true, address: true, logoUrl: true, brandColor: true,
      defaultDiscountPct: true, visibilityScore: true, featured: true, featuredUntil: true,
      category: true, city: true, province: true
    }
  });
  const matched = all.filter(
    (b) => resolveCategory(b.category).slug === catSlug && slugify(b.city) === citySlug
  );
  if (matched.length < MIN_RANKING) return null;

  // Reseñas agregadas por negocio.
  const ids = matched.map((b) => b.id);
  const aggs = await prisma.bubuiReview.groupBy({
    by: ["businessId"],
    where: { businessId: { in: ids } },
    _avg: { rating: true },
    _count: { _all: true }
  });
  const byId = new Map(aggs.map((a) => [a.businessId, { avg: a._avg.rating ?? 0, count: a._count._all }]));

  const now = Date.now();
  const scored = matched.map((b) => {
    const r = byId.get(b.id) ?? { avg: 0, count: 0 };
    const bayes = (CONFIDENCE * GLOBAL_MEAN + r.count * r.avg) / (CONFIDENCE + r.count); // 0..5
    const ratingScore = (bayes / 5) * 100;
    const score = Math.round(0.65 * ratingScore + 0.35 * b.visibilityScore);
    const featured = b.featured || (b.featuredUntil ? b.featuredUntil.getTime() > now : false);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      address: b.address,
      logoUrl: b.logoUrl,
      brandColor: b.brandColor,
      defaultDiscountPct: b.defaultDiscountPct,
      featured,
      ratingAvg: r.count > 0 ? Math.round(r.avg * 10) / 10 : null,
      ratingCount: r.count,
      score
    };
  });

  scored.sort((a, b) => b.score - a.score || b.ratingCount - a.ratingCount || a.name.localeCompare(b.name));
  const businesses = scored.map((b, i) => ({ position: i + 1, ...b }));

  return { category, cityLabel: matched[0].city, province: matched[0].province, businesses };
}

/** Pares nicho+localidad con suficientes negocios para tener ranking (sitemap). */
export async function getRankablePairs(): Promise<{ catSlug: string; citySlug: string }[]> {
  const all = await prisma.bubuiBusiness.findMany({ where: { active: true }, select: { category: true, city: true } });
  const counts = new Map<string, number>();
  for (const b of all) {
    const cs = slugify(b.city);
    if (!cs) continue;
    const key = `${resolveCategory(b.category).slug}/${cs}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= MIN_RANKING)
    .map(([key]) => {
      const [catSlug, citySlug] = key.split("/");
      return { catSlug, citySlug };
    });
}
