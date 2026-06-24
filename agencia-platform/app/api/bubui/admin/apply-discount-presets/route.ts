/**
 * POST /api/bubui/admin/apply-discount-presets
 *
 * Acción puntual (one-off): aplica los descuentos por acción preestablecidos a
 * los comercios EXISTENTES que aún tienen el valor antiguo por defecto, sin
 * pisar a quien ya lo haya personalizado. Presets:
 *   "Tus clientes te traen nuevos clientes": cliente 30% · 5 amigos · amigos 15%
 *   reseña 8% · seguir 5% · foto 5% · cupón 10% · recordatorio post-compra on.
 *
 * Auth: sesión NextAuth del Hub con rol ADMIN.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isBubuiAdmin } from "@/lib/bubui/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isBubuiAdmin(req))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }

  const [share, friends, friendPct, review, follow, photo, cross, pp] = await prisma.$transaction([
    // Reto "te traen nuevos clientes": cliente 30% (estaba en 0 o el antiguo 10).
    prisma.bubuiBusiness.updateMany({ where: { shareOfferPct: { in: [0, 10] } }, data: { shareOfferPct: 30 } }),
    prisma.bubuiBusiness.updateMany({ where: { shareOfferFriends: 0 }, data: { shareOfferFriends: 5 } }),
    // Descuento para los amigos: 15% (estaba en el antiguo 5).
    prisma.bubuiBusiness.updateMany({ where: { shareFriendDiscountPct: 5 }, data: { shareFriendDiscountPct: 15 } }),
    prisma.bubuiBusiness.updateMany({ where: { reviewRewardPct: 0 }, data: { reviewRewardPct: 8 } }),
    prisma.bubuiBusiness.updateMany({ where: { ppFollowDiscountPct: 0 }, data: { ppFollowDiscountPct: 5 } }),
    prisma.bubuiBusiness.updateMany({ where: { ppPhotoDiscountPct: 0 }, data: { ppPhotoDiscountPct: 5 } }),
    prisma.bubuiBusiness.updateMany({ where: { crossDiscountPct: 8 }, data: { crossDiscountPct: 10 } }),
    prisma.bubuiBusiness.updateMany({ where: { postPurchasePushEnabled: false }, data: { postPurchasePushEnabled: true } })
  ]);

  return NextResponse.json({
    ok: true,
    updated: {
      compartirCliente: share.count,
      amigos: friends.count,
      descuentoAmigos: friendPct.count,
      resena: review.count,
      seguir: follow.count,
      foto: photo.count,
      cuponCruzado: cross.count,
      recordatorioPostCompra: pp.count
    }
  });
}
