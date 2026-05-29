/**
 * Tarjeta de fidelidad (sellos digitales) por negocio.
 *
 * Modelo: cada compra CONFIRMADA del cliente en el negocio suma un sello.
 * Al llegar a `loyaltyGoal` sellos (5 por defecto) el cliente recibe
 * automáticamente un cupón con `loyaltyRewardPct` (o el texto
 * `loyaltyRewardLabel`) y la tarjeta arranca el siguiente ciclo.
 *
 * Idempotencia: usamos la clave única (customerId, businessId,
 * triggerBusinessId) de BubuiOffer con `loyalty:<businessId>:<cycle>` para
 * que reintentos no dupliquen recompensas. Un cliente puede completar la
 * tarjeta muchas veces (ciclo 1, 2, 3…) pero no farmea dentro de un ciclo.
 */

import { prisma } from "@/lib/db/prisma";

/** Tras una compra confirmada, otorga el cupón de fidelidad si el cliente
 *  acaba de completar la tarjeta. No falla la transacción si algo va mal —
 *  es best-effort y la compra ya está confirmada. */
export async function grantLoyaltyIfReached(opts: {
  customerId: string;
  businessId: string;
}): Promise<{ granted: boolean; cycle?: number; discountPct?: number; label?: string | null }> {
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: opts.businessId },
    select: { loyaltyEnabled: true, loyaltyGoal: true, loyaltyRewardPct: true, loyaltyRewardLabel: true }
  });
  if (!business?.loyaltyEnabled) return { granted: false };
  const goal = Math.max(2, business.loyaltyGoal || 5);
  const pct = Math.max(0, Math.min(90, business.loyaltyRewardPct || 0));
  const label = business.loyaltyRewardLabel?.trim() || null;
  if (pct === 0 && !label) return { granted: false }; // no hay recompensa configurada

  const count = await prisma.bubuiPurchase.count({
    where: { customerId: opts.customerId, businessId: opts.businessId, status: "confirmed" }
  });
  if (count <= 0 || count % goal !== 0) return { granted: false };

  const cycle = Math.floor(count / goal); // 1, 2, 3, ...
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días para canjear

  try {
    await prisma.bubuiOffer.create({
      data: {
        customerId: opts.customerId,
        businessId: opts.businessId,
        discountPct: pct,
        rewardLabel: label,
        triggerBusinessId: `loyalty:${opts.businessId}:${cycle}`,
        source: "loyalty",
        expiresAt
      }
    });
    return { granted: true, cycle, discountPct: pct, label };
  } catch {
    // P2002: el cupón de este ciclo ya existe (reintento). No es un error real.
    return { granted: false };
  }
}

/** Lista las tarjetas activas del cliente: negocios donde tiene compras
 *  confirmadas Y el dueño tiene la fidelidad activada. Devuelve el progreso
 *  del ciclo actual (count % goal) y el total de recompensas ya ganadas. */
export async function listLoyaltyCards(customerId: string): Promise<
  Array<{
    businessId: string;
    businessSlug: string;
    businessName: string;
    goal: number;
    rewardPct: number;
    rewardLabel: string | null;
    totalPurchases: number;
    stampsInCycle: number;
    cyclesCompleted: number;
  }>
> {
  // Trae negocios donde el cliente ha comprado confirmado y que tienen
  // fidelidad activa. Hacemos groupBy para no traer todas las compras.
  const grouped = await prisma.bubuiPurchase.groupBy({
    by: ["businessId"],
    where: { customerId, status: "confirmed" },
    _count: { _all: true }
  });
  if (grouped.length === 0) return [];

  const businesses = await prisma.bubuiBusiness.findMany({
    where: {
      id: { in: grouped.map((g) => g.businessId) },
      loyaltyEnabled: true,
      active: true
    },
    select: {
      id: true,
      slug: true,
      name: true,
      loyaltyGoal: true,
      loyaltyRewardPct: true,
      loyaltyRewardLabel: true
    }
  });
  const countByBiz = new Map(grouped.map((g) => [g.businessId, g._count._all]));

  return businesses
    .filter((b) => (b.loyaltyRewardPct ?? 0) > 0 || (b.loyaltyRewardLabel?.trim()?.length ?? 0) > 0)
    .map((b) => {
      const total = countByBiz.get(b.id) ?? 0;
      const goal = Math.max(2, b.loyaltyGoal || 5);
      return {
        businessId: b.id,
        businessSlug: b.slug,
        businessName: b.name,
        goal,
        rewardPct: b.loyaltyRewardPct ?? 0,
        rewardLabel: b.loyaltyRewardLabel?.trim() || null,
        totalPurchases: total,
        stampsInCycle: total % goal,
        cyclesCompleted: Math.floor(total / goal)
      };
    })
    .sort((a, b) => b.stampsInCycle - a.stampsInCycle);
}
