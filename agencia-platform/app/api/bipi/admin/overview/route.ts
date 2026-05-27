/**
 * GET /api/bipi/admin/overview
 *
 * Métricas globales de la red Bipi — pensado para que Negocio Vivo
 * supervise el piloto (Benalmádena).
 *
 * Auth simple v1: header `Authorization: Bearer ${BIPI_ADMIN_TOKEN}`.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const expected = process.env.BIPI_ADMIN_TOKEN;
  const auth = req.headers.get("authorization") ?? "";
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const city = url.searchParams.get("city") ?? undefined;

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86_400_000);
  const d30 = new Date(now.getTime() - 30 * 86_400_000);

  const whereBiz = city ? { city, active: true } : { active: true };

  const [
    totalBusinesses,
    totalCustomers,
    totalPurchases30,
    totalOffers30,
    redeemed30,
    revenue30,
    topByScanning,
    topByCross,
    plansBreakdown
  ] = await Promise.all([
    prisma.bipiBusiness.count({ where: whereBiz }),
    prisma.bipiCustomer.count(),
    prisma.bipiPurchase.count({
      where: {
        status: "confirmed",
        scannedAt: { gte: d30 },
        business: city ? { city } : undefined
      }
    }),
    prisma.bipiOffer.count({
      where: { createdAt: { gte: d30 }, business: city ? { city } : undefined }
    }),
    prisma.bipiOffer.count({
      where: {
        redeemed: true,
        redeemedAt: { gte: d30 },
        business: city ? { city } : undefined
      }
    }),
    prisma.bipiPurchase.aggregate({
      where: {
        status: "confirmed",
        scannedAt: { gte: d30 },
        business: city ? { city } : undefined
      },
      _sum: { amount: true }
    }),
    prisma.bipiPurchase.groupBy({
      by: ["businessId"],
      where: {
        status: "confirmed",
        scannedAt: { gte: d7 }
      },
      _count: { _all: true },
      orderBy: { _count: { businessId: "desc" } },
      take: 10
    }),
    prisma.bipiOffer.groupBy({
      by: ["businessId"],
      where: {
        redeemed: true,
        redeemedAt: { gte: d30 }
      },
      _count: { _all: true },
      orderBy: { _count: { businessId: "desc" } },
      take: 10
    }),
    prisma.bipiBusiness.groupBy({
      by: ["plan"],
      _count: { _all: true },
      where: whereBiz
    })
  ]);

  const topScanIds = topByScanning.map((t) => t.businessId);
  const topCrossIds = topByCross.map((t) => t.businessId);
  const allIds = Array.from(new Set([...topScanIds, ...topCrossIds]));
  const businesses = allIds.length
    ? await prisma.bipiBusiness.findMany({
        where: { id: { in: allIds } },
        select: { id: true, name: true, slug: true, category: true, city: true, visibilityScore: true }
      })
    : [];
  const bizMap = new Map(businesses.map((b) => [b.id, b]));

  const conversionPct =
    totalOffers30 > 0 ? Math.round((redeemed30 / totalOffers30) * 100) : 0;

  return NextResponse.json({
    scope: { city: city ?? "global" },
    summary: {
      businesses: totalBusinesses,
      customers: totalCustomers,
      purchases30: totalPurchases30,
      offers30: totalOffers30,
      offersRedeemed30: redeemed30,
      conversionPct,
      revenue30: revenue30._sum.amount ?? 0
    },
    plansBreakdown: plansBreakdown.map((p) => ({ plan: p.plan, count: p._count._all })),
    topByScanning: topByScanning.map((t) => ({
      business: bizMap.get(t.businessId) ?? { id: t.businessId, name: "?" },
      scans: t._count._all
    })),
    topByCross: topByCross.map((t) => ({
      business: bizMap.get(t.businessId) ?? { id: t.businessId, name: "?" },
      redeemed: t._count._all
    }))
  });
}
