/**
 * GET /api/bubui/customer/[id]
 *
 * Devuelve el perfil actualizado del cliente (stats vivas: total ahorrado,
 * número de compras, nivel embajador, número de cupones activos).
 *
 * Usado por la PWA para refrescar al abrir el feed sin hacer auth pesada.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const c = await prisma.bubuiCustomer.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      email: true,
      totalSaved: true,
      totalPurchases: true,
      ambassadorLevel: true
    }
  });
  if (!c) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const activeOffers = await prisma.bubuiOffer.count({
    where: { customerId: c.id, redeemed: false, expiresAt: { gt: new Date() } }
  });
  // Historial de ahorro: últimas compras confirmadas.
  const purchases = await prisma.bubuiPurchase.findMany({
    where: { customerId: c.id, status: "confirmed" },
    orderBy: { confirmedAt: "desc" },
    take: 20,
    select: {
      id: true,
      discountPct: true,
      discountAmount: true,
      confirmedAt: true,
      scannedAt: true,
      business: { select: { name: true } }
    }
  });
  return NextResponse.json({
    customerId: c.id,
    name: c.name,
    email: c.email,
    totalSaved: c.totalSaved,
    totalPurchases: c.totalPurchases,
    ambassadorLevel: c.ambassadorLevel,
    activeOffers,
    savings: purchases.map((p) => ({
      id: p.id,
      discountPct: p.discountPct,
      discountAmount: p.discountAmount,
      businessName: p.business?.name ?? "Negocio Bubui",
      date: p.confirmedAt ?? p.scannedAt
    }))
  });
}
