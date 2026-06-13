/**
 * Programa de referidos B2B de Bubui.
 *
 * Un negocio comparte su enlace de referido (`/bubui/registro?ref=<businessId>`
 * o su QR). Por cada 5 negocios que se den de alta con su referido Y tengan
 * actividad real (al menos un escaneo/compra), gana 1 SEMANA de banner del
 * Home de la app.
 *
 * El banner del Home es único/global, así que las recompensas se encolan
 * (BubuiBannerCampaign) y se sirven por turnos: siempre se muestra la campaña
 * activa más antigua; al expirar, se activa la siguiente de la cola.
 */

import { prisma } from "@/lib/db/prisma";

export const BUSINESSES_PER_REWARD = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cuenta los negocios referidos por `businessId` que cuentan para la
 * recompensa: están activos y tienen al menos una compra (actividad real).
 */
export async function countQualifiedBusinessReferrals(businessId: string): Promise<number> {
  const referred = await prisma.bubuiBusiness.findMany({
    where: { referrerId: businessId, active: true },
    select: { id: true }
  });
  if (referred.length === 0) return 0;
  // Negocios referidos con al menos una compra registrada.
  const withActivity = await prisma.bubuiPurchase.groupBy({
    by: ["businessId"],
    where: { businessId: { in: referred.map((b) => b.id) } },
    _count: { _all: true }
  });
  return withActivity.length;
}

/**
 * ¿El negocio tiene desbloqueadas las funciones "perk" (ej. Vivo Studio, el
 * copy con IA del Push del Día)? Se desbloquean con plan de pago O trayendo al
 * menos BUSINESSES_PER_REWARD (5) comercios referidos con actividad real.
 */
export async function hasVivoStudioAccess(businessId: string): Promise<{ eligible: boolean; paid: boolean; qualified: number; needed: number }> {
  const business = await prisma.bubuiBusiness.findUnique({ where: { id: businessId }, select: { plan: true } });
  const paid = business?.plan === "pro" || business?.plan === "premium";
  const qualified = await countQualifiedBusinessReferrals(businessId);
  const eligible = paid || qualified >= BUSINESSES_PER_REWARD;
  return { eligible, paid, qualified, needed: BUSINESSES_PER_REWARD };
}

/**
 * Sincroniza las recompensas de banner de un negocio: si por sus referidos
 * cualificados le corresponden más semanas de las ya concedidas, crea las
 * campañas de banner que falten (en cola) e incrementa el contador.
 *
 * Idempotente: se puede llamar tantas veces como se quiera (p. ej. tras cada
 * escaneo de un negocio referido) sin conceder de más.
 */
export async function syncBusinessReferralRewards(businessId: string): Promise<{
  qualified: number;
  weeksEarned: number;
  weeksGranted: number;
  newlyGranted: number;
}> {
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: businessId },
    select: { id: true, bannerWeeksGranted: true }
  });
  if (!business) return { qualified: 0, weeksEarned: 0, weeksGranted: 0, newlyGranted: 0 };

  const qualified = await countQualifiedBusinessReferrals(businessId);
  const weeksEarned = Math.floor(qualified / BUSINESSES_PER_REWARD);
  const already = business.bannerWeeksGranted ?? 0;
  const newlyGranted = Math.max(0, weeksEarned - already);

  if (newlyGranted > 0) {
    // Una campaña por semana ganada (cola). El negocio sube la imagen luego.
    for (let i = 0; i < newlyGranted; i++) {
      await prisma.bubuiBannerCampaign.create({
        data: { businessId, status: "queued", weeks: 1 }
      });
    }
    await prisma.bubuiBusiness.update({
      where: { id: businessId },
      data: { bannerWeeksGranted: weeksEarned }
    });
  }

  return { qualified, weeksEarned, weeksGranted: weeksEarned, newlyGranted };
}

/**
 * Avanza la cola de campañas de banner: expira las activas vencidas y activa
 * la siguiente en cola si no hay ninguna activa. Devuelve la campaña activa
 * (con imagen) lista para mostrarse en el Home, o null.
 *
 * Pensado para llamarse desde el endpoint público del banner (perezoso) y/o
 * un cron.
 */
export async function tickBannerQueue(): Promise<
  | { id: string; businessId: string; imageUrl: string | null; link: string | null; endsAt: Date }
  | null
> {
  const now = new Date();

  // 1) Cerrar las activas ya vencidas.
  await prisma.bubuiBannerCampaign.updateMany({
    where: { status: "active", endsAt: { lte: now } },
    data: { status: "done" }
  });

  // 2) ¿Hay una activa vigente?
  let active = await prisma.bubuiBannerCampaign.findFirst({
    where: { status: "active", endsAt: { gt: now } },
    orderBy: { startsAt: "asc" }
  });

  // 3) Si no, activar la siguiente en cola (FIFO por antigüedad).
  if (!active) {
    const next = await prisma.bubuiBannerCampaign.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" }
    });
    if (next) {
      active = await prisma.bubuiBannerCampaign.update({
        where: { id: next.id },
        data: { status: "active", startsAt: now, endsAt: new Date(now.getTime() + next.weeks * WEEK_MS) }
      });
    }
  }

  if (!active || !active.endsAt) return null;
  return {
    id: active.id,
    businessId: active.businessId,
    imageUrl: active.imageUrl,
    link: active.link,
    endsAt: active.endsAt
  };
}
