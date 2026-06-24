/**
 * POST /api/v1/admin/bubui/apply-discount-presets
 *
 * Acción puntual (one-off): aplica los descuentos por acción preestablecidos a
 * los comercios EXISTENTES que aún tienen el valor antiguo por defecto, sin
 * pisar a quien ya lo haya personalizado. Presets:
 *   compartir 10% (5 amigos) · reseña 8% · seguir 5% · foto 5% · cupón 10% ·
 *   recordatorio post-compra activado.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async () => {
  const [share, friends, review, follow, photo, cross, pp] = await prisma.$transaction([
    prisma.bubuiBusiness.updateMany({ where: { shareOfferPct: 0 }, data: { shareOfferPct: 10 } }),
    prisma.bubuiBusiness.updateMany({ where: { shareOfferFriends: 0 }, data: { shareOfferFriends: 5 } }),
    prisma.bubuiBusiness.updateMany({ where: { reviewRewardPct: 0 }, data: { reviewRewardPct: 8 } }),
    prisma.bubuiBusiness.updateMany({ where: { ppFollowDiscountPct: 0 }, data: { ppFollowDiscountPct: 5 } }),
    prisma.bubuiBusiness.updateMany({ where: { ppPhotoDiscountPct: 0 }, data: { ppPhotoDiscountPct: 5 } }),
    prisma.bubuiBusiness.updateMany({ where: { crossDiscountPct: 8 }, data: { crossDiscountPct: 10 } }),
    prisma.bubuiBusiness.updateMany({ where: { postPurchasePushEnabled: false }, data: { postPurchasePushEnabled: true } })
  ]);

  return NextResponse.json({
    ok: true,
    updated: {
      compartir: share.count,
      amigos: friends.count,
      resena: review.count,
      seguir: follow.count,
      foto: photo.count,
      cuponCruzado: cross.count,
      recordatorioPostCompra: pp.count
    }
  });
});
