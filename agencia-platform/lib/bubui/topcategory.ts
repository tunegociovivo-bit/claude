/**
 * "Top 3 en categoría" — ranking ganado (no comprado) por ciudad+categoría.
 *
 * Métrica: nº de compras confirmadas en los últimos 30 días. Empate por
 * visibilityScore. Top 3 obtiene el badge. La métrica NO incluye `featured`
 * (que es de pago) para que el ranking siga siendo señal de prestigio real.
 *
 * Pensado para usarse en muchos sitios (página pública, Descubre, mapa) sin
 * recomputar todo el rato → caché en memoria con TTL.
 */

import { prisma } from "@/lib/db/prisma";

const CACHE_TTL_MS = 10 * 60_000; // 10 min

type Ranking = { topIdsByCategory: Map<string, string[]>; computedAt: number };
const cacheByCity = new Map<string, Ranking>();

async function computeRankingForCity(city: string): Promise<Ranking> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Conteo de compras confirmadas en los últimos 30 días por business.
  const purchases = await prisma.bubuiPurchase.groupBy({
    by: ["businessId"],
    where: { status: "confirmed", confirmedAt: { gte: since } },
    _count: { _all: true }
  });
  const countByBiz = new Map(purchases.map((p) => [p.businessId, p._count._all]));

  // Trae todos los negocios activos de la ciudad (sin filtrar por purchases
  // para que las nuevas categorías también aparezcan, aunque con 0).
  const businesses = await prisma.bubuiBusiness.findMany({
    where: { city, active: true },
    select: { id: true, category: true, visibilityScore: true }
  });

  // Agrupa por categoría → ordena por (purchases desc, visibilityScore desc) → top 3.
  const byCategory = new Map<string, Array<{ id: string; purchases: number; score: number }>>();
  for (const b of businesses) {
    const key = b.category.trim().toLowerCase();
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push({
      id: b.id,
      purchases: countByBiz.get(b.id) ?? 0,
      score: b.visibilityScore ?? 0
    });
  }
  const topIdsByCategory = new Map<string, string[]>();
  for (const [cat, list] of byCategory) {
    list.sort((a, b) => b.purchases - a.purchases || b.score - a.score);
    topIdsByCategory.set(
      cat,
      list
        .filter((x) => x.purchases > 0) // sin actividad no hay top — evita "top" de 1 con 0 compras
        .slice(0, 3)
        .map((x) => x.id)
    );
  }
  return { topIdsByCategory, computedAt: Date.now() };
}

async function rankingForCity(city: string): Promise<Ranking> {
  const cached = cacheByCity.get(city);
  if (cached && Date.now() - cached.computedAt < CACHE_TTL_MS) return cached;
  const fresh = await computeRankingForCity(city);
  cacheByCity.set(city, fresh);
  return fresh;
}

/** Devuelve la posición (1, 2 o 3) del negocio en el top de su categoría
 *  en su ciudad, o null si no está en el top. */
export async function getTopPosition(opts: {
  businessId: string;
  city: string;
  category: string;
}): Promise<number | null> {
  const r = await rankingForCity(opts.city);
  const ids = r.topIdsByCategory.get(opts.category.trim().toLowerCase()) ?? [];
  const idx = ids.indexOf(opts.businessId);
  return idx >= 0 ? idx + 1 : null;
}

/** Devuelve un Set con los businessIds que son top en su (city, category)
 *  para anotar listas grandes (Descubre, mapa). */
export async function getTopBusinessIds(city: string): Promise<Set<string>> {
  const r = await rankingForCity(city);
  const ids = new Set<string>();
  for (const list of r.topIdsByCategory.values()) for (const id of list) ids.add(id);
  return ids;
}
