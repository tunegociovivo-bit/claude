/**
 * GET /api/bubui/business/[id]/dashboard
 *
 * Datos para el panel del negocio:
 *   - perfil
 *   - compras pendientes (a confirmar AHORA)
 *   - métricas (7d, 30d)
 *   - ofertas cruzadas recibidas/canjeadas
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { getAiBannerPolicy } from "@/lib/bubui/ai-banner-settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  if (!(await businessTokenAllows(req.headers.get("authorization"), id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  const business = await prisma.bubuiBusiness.findUnique({ where: { id } });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86_400_000);
  const d14 = new Date(now.getTime() - 14 * 86_400_000);
  const prev7 = new Date(now.getTime() - 14 * 86_400_000); // ventana 7d anterior: [prev7, d7)
  const d30 = new Date(now.getTime() - 30 * 86_400_000);

  const [pending, scans7, scansPrev7, scans30, redeemedFromOthers7, offersOpen, confirmed14, customers30] = await Promise.all([
    prisma.bubuiPurchase.findMany({
      where: { businessId: id, status: "pending" },
      orderBy: { scannedAt: "desc" },
      take: 50,
      // Sin email: el negocio solo necesita el nombre para identificar al
      // cliente antes de confirmar; el email no se expone en compras pendientes.
      include: { customer: { select: { id: true, name: true } } }
    }),
    prisma.bubuiPurchase.count({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: d7 } }
    }),
    prisma.bubuiPurchase.count({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: prev7, lt: d7 } }
    }),
    prisma.bubuiPurchase.count({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: d30 } }
    }),
    prisma.bubuiOffer.count({
      where: { businessId: id, redeemed: true, redeemedAt: { gte: d7 } }
    }),
    prisma.bubuiOffer.count({
      where: { businessId: id, redeemed: false, expiresAt: { gt: now } }
    }),
    prisma.bubuiPurchase.findMany({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: d14 } },
      select: { amount: true, scannedAt: true }
    }),
    prisma.bubuiPurchase.findMany({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: d30 } },
      select: { customerId: true },
      distinct: ["customerId"]
    })
  ]);

  const revenue7 = await prisma.bubuiPurchase.aggregate({
    where: { businessId: id, status: "confirmed", scannedAt: { gte: d7 } },
    _sum: { amount: true }
  });
  const revenue30 = await prisma.bubuiPurchase.aggregate({
    where: { businessId: id, status: "confirmed", scannedAt: { gte: d30 } },
    _sum: { amount: true }
  });

  // Serie diaria de ventas (últimos 14 días) para la gráfica del panel.
  const dailyRevenue: { day: string; total: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    dailyRevenue.push({ day: d.toISOString().slice(0, 10), total: 0 });
  }
  const idxByDay = new Map(dailyRevenue.map((d, i) => [d.day, i]));
  for (const p of confirmed14) {
    const key = new Date(p.scannedAt).toISOString().slice(0, 10);
    const i = idxByDay.get(key);
    if (i != null) dailyRevenue[i].total += p.amount;
  }

  const notifications = await prisma.bubuiBusinessNotification.findMany({
    where: { businessId: id, read: false },
    orderBy: { createdAt: "desc" },
    take: 20
  });

  const rev7 = revenue7._sum.amount ?? 0;
  const rev30 = revenue30._sum.amount ?? 0;
  const ticketMedio = scans30 > 0 ? rev30 / scans30 : 0;
  const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

  return NextResponse.json({
    business: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      category: business.category,
      city: business.city,
      plan: business.plan,
      defaultDiscountPct: business.defaultDiscountPct,
      crossDiscountPct: business.crossDiscountPct,
      visibilityScore: business.visibilityScore,
      qrPngUrl: `/api/bubui/business/${business.id}/qr.png`,
      referralEnabled: business.referralEnabled,
      referralReward1: business.referralReward1,
      referralReward3: business.referralReward3,
      referralReward5: business.referralReward5,
      // Perfil editable (inicializa el formulario "Editar perfil").
      description: business.description,
      address: business.address,
      latitude: business.latitude,
      longitude: business.longitude,
      logoUrl: business.logoUrl,
      brandColor: business.brandColor,
      purchaseMode: business.purchaseMode,
      requireTicket: business.requireTicket,
      reviewRewardPct: business.reviewRewardPct,
      googlePlaceId: business.googlePlaceId,
      reviewPushEnabled: business.reviewPushEnabled,
      shareOfferPct: business.shareOfferPct,
      shareOfferFriends: business.shareOfferFriends,
      shareOfferLabel: business.shareOfferLabel,
      // Entrega de la pegatina/cartel QR (CTA "te la llevamos gratis").
      posterDeliveryRequestedAt: business.posterDeliveryRequestedAt,
      posterDeliveredAt: business.posterDeliveredAt,
      // Banner IA: cuántas generaciones lleva (0 = la primera es gratis),
      // créditos de pago disponibles (1€ cada uno) y si el admin lo tiene
      // limitado a planes de pago.
      aiBannerUsed: business.aiBannerUsed,
      aiBannerCredits: business.aiBannerCredits,
      aiBannerPaidOnly: (await getAiBannerPolicy()) === "paid",
      // Tipo de negocio (panel por nicho) + config de la Mesa Colectiva.
      businessType: business.businessType,
      mesaEnabled: business.mesaEnabled,
      mesaBasePct: business.mesaBasePct,
      mesaMinDiners: business.mesaMinDiners,
      mesaShareBonusPct: business.mesaShareBonusPct,
      mesaReviewBonusPct: business.mesaReviewBonusPct,
      mesaMaxPct: business.mesaMaxPct,
      mesaJoinWindowMin: business.mesaJoinWindowMin,
      mesaNextVisitDays: business.mesaNextVisitDays,
      mesaBonusOnThisVisit: business.mesaBonusOnThisVisit,
      mesaVeteranMustContribute: business.mesaVeteranMustContribute,
      mesaVeteranShareFriends: business.mesaVeteranShareFriends,
      mesaAutoAdjust: business.mesaAutoAdjust,
      mesaActShare: business.mesaActShare,
      mesaActReview: business.mesaActReview,
      mesaActPhoto: business.mesaActPhoto,
      mesaActFollow: business.mesaActFollow
    },
    notifications: notifications.map((n) => ({ id: n.id, message: n.message, createdAt: n.createdAt })),
    pending: pending.map((p) => ({
      id: p.id,
      amount: p.amount,
      discountPct: p.discountPct,
      discountAmount: p.discountAmount,
      scannedAt: p.scannedAt,
      offerRedeemed: !!p.redeemedOfferId,
      customer: p.customer
    })),
    metrics: {
      scans7,
      scans30,
      revenue7: rev7,
      revenue30: rev30,
      redeemedFromOthers7,
      offersOpen,
      newCustomers30: customers30.length,
      ticketMedio,
      dailyRevenue,
      deltas: {
        scans7: pct(scans7, scansPrev7)
      }
    }
  });
}
