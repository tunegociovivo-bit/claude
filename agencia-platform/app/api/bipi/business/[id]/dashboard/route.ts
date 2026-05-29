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

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const business = await prisma.bubuiBusiness.findUnique({ where: { id } });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86_400_000);
  const d30 = new Date(now.getTime() - 30 * 86_400_000);

  const [pending, scans7, scans30, redeemedFromOthers7, offersOpen] = await Promise.all([
    prisma.bubuiPurchase.findMany({
      where: { businessId: id, status: "pending" },
      orderBy: { scannedAt: "desc" },
      take: 50,
      include: { customer: { select: { id: true, name: true, email: true } } }
    }),
    prisma.bubuiPurchase.count({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: d7 } }
    }),
    prisma.bubuiPurchase.count({
      where: { businessId: id, status: "confirmed", scannedAt: { gte: d30 } }
    }),
    prisma.bubuiOffer.count({
      where: { businessId: id, redeemed: true, redeemedAt: { gte: d7 } }
    }),
    prisma.bubuiOffer.count({
      where: {
        businessId: id,
        redeemed: false,
        expiresAt: { gt: now }
      }
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
      qrPngUrl: `/api/bipi/business/${business.id}/qr.png`
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
      revenue7: revenue7._sum.amount ?? 0,
      revenue30: revenue30._sum.amount ?? 0,
      redeemedFromOthers7,
      offersOpen
    }
  });
}
