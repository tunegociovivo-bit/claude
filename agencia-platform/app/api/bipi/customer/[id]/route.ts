/**
 * GET /api/bipi/customer/[id]
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
  const c = await prisma.bipiCustomer.findUnique({
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
  const activeOffers = await prisma.bipiOffer.count({
    where: { customerId: c.id, redeemed: false, expiresAt: { gt: new Date() } }
  });
  return NextResponse.json({
    customerId: c.id,
    name: c.name,
    email: c.email,
    totalSaved: c.totalSaved,
    totalPurchases: c.totalPurchases,
    ambassadorLevel: c.ambassadorLevel,
    activeOffers
  });
}
