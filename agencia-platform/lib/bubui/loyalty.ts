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

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/** Recupera todos los ciclos completados, incluso si se omitió un premio anterior.
 * Debe compartir la transacción de la compra; un fallo se propaga y revierte. */
export async function grantLoyaltyIfReached(opts: {
  customerId: string;
  businessId: string;
}, db: Prisma.TransactionClient = prisma): Promise<{ granted: boolean; cycle?: number; discountPct?: number; label?: string | null }> {
  const business = await db.bubuiBusiness.findUnique({
    where: { id: opts.businessId },
    select: { loyaltyEnabled: true, loyaltyGoal: true, loyaltyRewardPct: true, loyaltyRewardLabel: true }
  });
  if (!business?.loyaltyEnabled) return { granted: false };
  const goal = Math.max(2, business.loyaltyGoal || 5);
  const pct = Math.max(0, Math.min(90, business.loyaltyRewardPct || 0));
  const label = business.loyaltyRewardLabel?.trim() || null;
  if (pct === 0 && !label) return { granted: false }; // no hay recompensa configurada

  const count = await db.bubuiPurchase.count({
    where: { customerId: opts.customerId, businessId: opts.businessId, status: "confirmed" }
  });
  if (count < goal) return { granted: false };

  const cycle = Math.floor(count / goal); // 1, 2, 3, ...
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días para canjear

  let granted = false;
  // Batches bound SQL parameter count without skipping old missing cycles.
  for (let first = 1; first <= cycle; first += 100) {
    const result = await db.bubuiOffer.createMany({
      data: Array.from({ length: Math.min(100, cycle - first + 1) }, (_, offset) => ({
        customerId: opts.customerId,
        businessId: opts.businessId,
        discountPct: pct,
        rewardLabel: label,
        triggerBusinessId: `loyalty:${opts.businessId}:${first + offset}`,
        source: "loyalty",
        expiresAt
      })),
      skipDuplicates: true
    });
    granted ||= result.count > 0;
  }
  return { granted, cycle, discountPct: pct, label };
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
