/**
 * GET /api/bubui/admin/overview
 *
 * Métricas globales de la red Bubui — pensado para que Negocio Vivo
 * supervise el piloto (Benalmádena).
 *
 * Auth: sesión NextAuth del Hub con rol ADMIN.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isBubuiAdmin } from "@/lib/bubui/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isBubuiAdmin(req))) {
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
    plansBreakdown,
    appVersionGroups
  ] = await Promise.all([
    prisma.bubuiBusiness.count({ where: whereBiz }),
    prisma.bubuiCustomer.count(),
    prisma.bubuiPurchase.count({
      where: {
        status: "confirmed",
        scannedAt: { gte: d30 },
        business: city ? { city } : undefined
      }
    }),
    prisma.bubuiOffer.count({
      where: { createdAt: { gte: d30 }, business: city ? { city } : undefined }
    }),
    prisma.bubuiOffer.count({
      where: {
        redeemed: true,
        redeemedAt: { gte: d30 },
        business: city ? { city } : undefined
      }
    }),
    prisma.bubuiPurchase.aggregate({
      where: {
        status: "confirmed",
        scannedAt: { gte: d30 },
        business: city ? { city } : undefined
      },
      _sum: { amount: true }
    }),
    prisma.bubuiPurchase.groupBy({
      by: ["businessId"],
      where: {
        status: "confirmed",
        scannedAt: { gte: d7 }
      },
      _count: { _all: true },
      orderBy: { _count: { businessId: "desc" } },
      take: 10
    }),
    prisma.bubuiOffer.groupBy({
      by: ["businessId"],
      where: {
        redeemed: true,
        redeemedAt: { gte: d30 }
      },
      _count: { _all: true },
      orderBy: { _count: { businessId: "desc" } },
      take: 10
    }),
    prisma.bubuiBusiness.groupBy({
      by: ["plan"],
      _count: { _all: true },
      where: whereBiz
    }),
    // Versiones de la app instaladas (global, no depende de ciudad).
    prisma.bubuiCustomer.groupBy({
      by: ["appBuild"],
      _count: { _all: true }
    })
  ]);

  const topScanIds = topByScanning.map((t) => t.businessId);
  const topCrossIds = topByCross.map((t) => t.businessId);
  const allIds = Array.from(new Set([...topScanIds, ...topCrossIds]));
  const businesses = allIds.length
    ? await prisma.bubuiBusiness.findMany({
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
    })),
    appVersions: appVersionGroups
      .map((g: any) => ({ build: g.appBuild as string | null, count: g._count._all }))
      .sort((a, b) => {
        if (a.build == null) return 1;
        if (b.build == null) return -1;
        return Number(b.build) - Number(a.build);
      })
  });
}
