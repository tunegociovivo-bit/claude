/**
 * Ranking mensual de negocios Bubui: el que más clientes distintos atrae en
 * el mes. Gamifica a los dueños (compiten por el "destacado gratis") → más
 * empuje del QR. Lo consume el panel del negocio y el cron del premio mensual.
 */
import { prisma } from "@/lib/db/prisma";

/** Inicio del mes (hora de Madrid, aproximada a UTC) que contiene `ref`. */
export function startOfMonth(ref: Date = new Date()): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1, 0, 0, 0));
}

/** Fin del mes (exclusivo) que contiene `ref`. */
export function endOfMonth(ref: Date = new Date()): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1, 0, 0, 0));
}

export type RankingRow = {
  position: number;
  businessId: string;
  name: string;
  city: string | null;
  logoUrl: string | null;
  customers: number; // clientes distintos con compra confirmada en el mes
};

/**
 * Ranking de negocios por clientes distintos con compra confirmada dentro de
 * [from, to). Solo negocios activos. Empate → por nombre (estable).
 */
export async function getMonthlyRanking(from?: Date, to?: Date): Promise<RankingRow[]> {
  const start = from ?? startOfMonth();
  const end = to ?? endOfMonth(start);

  const purchases = await prisma.bubuiPurchase.findMany({
    where: { status: "confirmed", scannedAt: { gte: start, lt: end } },
    select: { businessId: true, customerId: true }
  });
  const byBiz = new Map<string, Set<string>>();
  for (const p of purchases) {
    let set = byBiz.get(p.businessId);
    if (!set) byBiz.set(p.businessId, (set = new Set()));
    set.add(p.customerId);
  }

  const businesses = await prisma.bubuiBusiness.findMany({
    where: { active: true },
    select: { id: true, name: true, city: true, logoUrl: true }
  });

  return businesses
    .map((b) => ({
      businessId: b.id,
      name: b.name,
      city: b.city,
      logoUrl: b.logoUrl,
      customers: byBiz.get(b.id)?.size ?? 0
    }))
    .sort((a, b) => b.customers - a.customers || a.name.localeCompare(b.name))
    .map((r, i) => ({ position: i + 1, ...r }));
}

/** Posición de un negocio concreto + top 5 + total, para su panel. */
export async function getBusinessRanking(businessId: string): Promise<{
  position: number | null;
  total: number;
  customers: number;
  top: RankingRow[];
}> {
  const ranking = await getMonthlyRanking();
  const mine = ranking.find((r) => r.businessId === businessId) ?? null;
  return {
    position: mine?.position ?? null,
    total: ranking.length,
    customers: mine?.customers ?? 0,
    top: ranking.slice(0, 5)
  };
}
