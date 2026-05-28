/**
 * GET /api/bipi/business/[id]/dashboard
 *
 * Datos para el panel del negocio:
 *   - perfil
 *   - compras pendientes (a confirmar AHORA)
 *   - métricas (7d, 30d)
 *   - ofertas cruzadas recibidas/canjeadas
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bipi/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  if (!businessTokenAllows(req.headers.get("authorization"), id)) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  const business = await prisma.bipiBusiness.findUnique({ where: { id } });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86_400_000);
  const d14 = new Date(now.getTime() - 14 * 86_400_000);
  const prev7 = new Date(now.getTime() - 14 * 86_400_000); // ventana 7d anterior: [prev7, d7)
  const d30 = new Date(now.getTime() - 30 * 86_400_000);

  const [pending, scans7, scansPrev7, scans30, redeemedFromOthers7, offersOpen, confirmed14, customers30] = await Promise.all([
    prisma.bipiPurchase.findMany({
      where: { businessId: id, status: "pending" },
      orderBy: { scannedAt: "desc" },
      take: 50,
      include: { customer: { select: { id: true, name: true, email: true } } }
    }),
    prisma.bipiPurchase.count({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: d7 } }
    }),
    prisma.bipiPurchase.count({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: prev7, lt: d7 } }
    }),
    prisma.bipiPurchase.count({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: d30 } }
    }),
    prisma.bipiOffer.count({
      where: { businessId: id, redeemed: true, redeemedAt: { gte: d7 } }
    }),
    prisma.bipiOffer.count({
      where: { businessId: id, redeemed: false, expiresAt: { gt: now } }
    }),
    prisma.bipiPurchase.findMany({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: d14 } },
      select: { amount: true, scannedAt: true }
    }),
    prisma.bipiPurchase.findMany({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: d30 } },
      select: { customerId: true },
      distinct: ["customerId"]
    })
  ]);

  const revenue7 = await prisma.bipiPurchase.aggregate({
    where: { businessId: id, status: "confirmed", scannedAt: { gte: d7 } },
    _sum: { amount: true }
  });
  const revenue30 = await prisma.bipiPurchase.aggregate({
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
      qrPngUrl: `/api/bipi/business/${business.id}/qr.png`,
      referralEnabled: business.referralEnabled,
      referralReward1: business.referralReward1,
      referralReward3: business.referralReward3,
      referralReward5: business.referralReward5
    },
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
