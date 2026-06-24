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
import { getPlusEnabled } from "@/lib/bubui/plus";
import { effectiveWalletPct } from "@/lib/bubui/wallet";

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
      subscriptionCancelAt: true,
      referralWalletPct: true,
      referralWalletExpiresAt: true,
      referralQualifiedCount: true
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
  // ¿Mostrar el alta de Plus en la app? (interruptor del admin)
  const plusEnabled = await getPlusEnabled();
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
    plusEnabled,
    planExpiresAt: c.planExpiresAt,
    subscriptionCancelAt: c.subscriptionCancelAt,
    activeOffers,
    // Hucha de referidos: % efectivo (0 si caducó), caducidad y nº de amigos cualificados.
    referralWalletPct: effectiveWalletPct(c),
    referralWalletExpiresAt: c.referralWalletExpiresAt,
    referralQualifiedCount: c.referralQualifiedCount,
    savings: purchases.map((p) => ({
      id: p.id,
      discountPct: p.discountPct,
      discountAmount: p.discountAmount,
      businessName: p.business?.name ?? "Negocio Bubui",
      date: p.confirmedAt ?? p.scannedAt
    }))
  });
}

/**
 * DELETE /api/bubui/customer/[id]
 *
 * Elimina la cuenta del cliente y todos sus datos (requisito de Apple,
 * guideline 5.1.1(v): toda app que permite crear cuenta debe permitir
 * borrarla). Borra primero las tablas dependientes que NO tienen borrado en
 * cascada y desvincula a los amigos referidos; el resto cae por cascade.
 *
 * Auth: token de sesión del propio cliente.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!(await customerAuthOk(req, params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  const id = params.id;
  const exists = await prisma.bubuiCustomer.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  await prisma.$transaction([
    prisma.bubuiPushSubscription.deleteMany({ where: { customerId: id } }),
    prisma.bubuiMobilePushToken.deleteMany({ where: { customerId: id } }),
    prisma.bubuiTicketScan.deleteMany({ where: { customerId: id } }),
    prisma.bubuiTableParticipant.deleteMany({ where: { customerId: id } }),
    prisma.bubuiBooking.deleteMany({ where: { customerId: id } }),
    // Desvincula a los clientes que este usuario refirió (no se borran ellos).
    prisma.bubuiCustomer.updateMany({ where: { referredById: id }, data: { referredById: null } }),
    // El resto de datos (compras, ofertas, reseñas, follows, push log…) caen
    // por onDelete: Cascade al borrar el cliente.
    prisma.bubuiCustomer.delete({ where: { id } })
  ]);

  return NextResponse.json({ ok: true });
}
