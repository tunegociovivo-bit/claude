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
import { customerAuthOk } from "@/lib/bubui/customer-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await customerAuthOk(req, params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  const c = await prisma.bubuiCustomer.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      email: true,
      totalSaved: true,
      totalPurchases: true,
      ambassadorLevel: true,
      firstBusinessId: true,
      plan: true,
      planExpiresAt: true,
      subscriptionCancelAt: true
    }
  });
  if (!c) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  // Ciudad inferida del negocio de origen para filtrar el slot patrocinado
  // del feed del cliente. Si no tiene origen → null (no se muestra nada).
  let city: string | null = null;
  if (c.firstBusinessId) {
    const b = await prisma.bubuiBusiness.findUnique({
      where: { id: c.firstBusinessId },
      select: { city: true }
    });
    city = b?.city ?? null;
  }
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
  // Bubui Plus activo si el plan es "plus" y no ha caducado.
  const plusActive = c.plan === "plus" && (!c.planExpiresAt || c.planExpiresAt > new Date());
  return NextResponse.json({
    customerId: c.id,
    name: c.name,
    email: c.email,
    totalSaved: c.totalSaved,
    totalPurchases: c.totalPurchases,
    ambassadorLevel: c.ambassadorLevel,
    city,
    plan: c.plan,
    plusActive,
    planExpiresAt: c.planExpiresAt,
    subscriptionCancelAt: c.subscriptionCancelAt,
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
