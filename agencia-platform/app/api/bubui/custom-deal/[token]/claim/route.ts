/**
 * POST /api/bubui/custom-deal/[token]/claim   { customerId }
 *
 * El cliente reclama un reto personalizado del comercio. Crea una oferta-reto
 * BLOQUEADA (source share_challenge) con SU descuento, que se activará cuando
 * traiga a los amigos requeridos. Devuelve su enlace para compartir con amigos
 * (los amigos reciben friendDiscountPct al darse de alta — ver applyReferral).
 *
 * Auth: token de sesión del propio cliente (Bearer <customerId>:<token>).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { ensureReferralCode, countVerifiedReferrals } from "@/lib/bubui/referral";
import { bubuiUrl } from "@/lib/bubui/url";

export const dynamic = "force-dynamic";

const schema = z.object({ customerId: z.string().min(1) });

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: "Falta customerId" } }, { status: 400 });
  }
  const { customerId } = parsed.data;
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }

  const deal = await prisma.bubuiCustomDeal.findUnique({ where: { token: params.token } });
  if (!deal) return NextResponse.json({ error: { code: "not_found", message: "Reto no encontrado" } }, { status: 404 });
  if (deal.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: { code: "expired", message: "Este reto ha caducado" } }, { status: 410 });
  }

  const code = await ensureReferralCode(customerId);
  const shareUrl = bubuiUrl(`/r/${code}`);

  // Ya reclamado: idempotente para el dueño del reto; bloqueado para otros.
  if (deal.claimedByCustomerId) {
    if (deal.claimedByCustomerId !== customerId) {
      return NextResponse.json({ error: { code: "already_claimed", message: "Este reto ya lo reclamó otra persona" } }, { status: 409 });
    }
    return NextResponse.json({
      ok: true, alreadyClaimed: true, referralCode: code, shareUrl,
      clientDiscountPct: deal.clientDiscountPct, friendsRequired: deal.friendsRequired, friendDiscountPct: deal.friendDiscountPct
    });
  }

  // Crea la oferta-reto bloqueada para el cliente (reutiliza el motor existente).
  const baseline = await countVerifiedReferrals(customerId);
  const offer = await prisma.bubuiOffer.create({
    data: {
      customerId,
      businessId: deal.businessId,
      discountPct: deal.clientDiscountPct,
      rewardLabel: deal.title?.trim() || null,
      triggerBusinessId: `deal:${deal.id}`,
      source: "share_challenge",
      active: false,
      unlockShares: Math.max(1, deal.friendsRequired),
      unlockBaseline: baseline,
      expiresAt: deal.expiresAt
    }
  });

  // Vincula el negocio de origen del cliente (para financiar los cupones de los
  // amigos) si aún no tenía, y marca el reto como reclamado.
  await prisma.bubuiCustomer.updateMany({
    where: { id: customerId, firstBusinessId: null },
    data: { firstBusinessId: deal.businessId }
  });
  await prisma.bubuiCustomDeal.update({
    where: { id: deal.id },
    data: { claimedByCustomerId: customerId, claimedAt: new Date(), offerId: offer.id }
  });

  return NextResponse.json({
    ok: true, referralCode: code, shareUrl,
    clientDiscountPct: deal.clientDiscountPct, friendsRequired: deal.friendsRequired, friendDiscountPct: deal.friendDiscountPct
  });
}
