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
import { applyReferral, ensureReferralCode, countVerifiedReferrals, countQualifiedReferrals } from "@/lib/bubui/referral";
import { bubuiUrl } from "@/lib/bubui/url";
import { alertBusiness } from "@/lib/bubui/business-push";
import { recordDealTrace } from "@/lib/bubui/deal-trace";
import { challengeReferralUrl } from "@/lib/bubui/custom-deal";

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

  // Ya reclamado: idempotente para el dueño. Para cualquier amigo que abra
  // el WhatsApp original, el token pasa a actuar como alias de la invitación
  // contextual del dueño (mismo resultado que /bubui/r/CODE?offer=ID).
  if (deal.claimedByCustomerId) {
    if (deal.claimedByCustomerId !== customerId) {
      if (!deal.offerId) {
        return NextResponse.json({ error: { code: "already_claimed", message: "Este reto ya lo reclamó otra persona" } }, { status: 409 });
      }
      const ownerCode = await ensureReferralCode(deal.claimedByCustomerId);
      const joined = await applyReferral(customerId, ownerCode, deal.offerId);
      if (!joined.linked) {
        return NextResponse.json({ error: { code: joined.reason, message: "No se pudo vincular esta invitación" } }, { status: 409 });
      }
      if (!joined.terminal) {
        return NextResponse.json({ error: { code: joined.reason, message: "La invitación se completará al reintentar" } }, { status: 503 });
      }
      void recordDealTrace({ token: params.token, stage: "web_claim_ok", source: "server" });
      return NextResponse.json({
        ok: true,
        joinedAsFriend: true,
        referralCode: ownerCode,
        shareUrl: challengeReferralUrl(ownerCode, deal.offerId),
        ...joined
      });
    }
    const code = await ensureReferralCode(customerId);
    const genericShareUrl = bubuiUrl(`/bubui/r/${code}`);
    void recordDealTrace({ token: params.token, stage: "web_claim_ok", source: "server" });
    return NextResponse.json({
      ok: true, alreadyClaimed: true, referralCode: code,
      shareUrl: deal.offerId ? challengeReferralUrl(code, deal.offerId) : genericShareUrl,
      clientDiscountPct: deal.clientDiscountPct, friendsRequired: deal.friendsRequired, friendDiscountPct: deal.friendDiscountPct
    });
  }

  const code = await ensureReferralCode(customerId);
  const claimingCustomer = await prisma.bubuiCustomer.findUnique({ where: { id: customerId }, select: { name: true } });

  // Crea la oferta-reto bloqueada para el cliente (reutiliza el motor existente).
  // El baseline usa el mismo criterio que el desbloqueo (instalar vs comprar).
  const baseline = deal.requiresPurchase
    ? await countQualifiedReferrals(customerId, deal.businessId)
    : await countVerifiedReferrals(customerId);
  const offer = await prisma.$transaction(async (tx) => {
  const created = await tx.bubuiOffer.create({
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
      unlockRequiresPurchase: deal.requiresPurchase,
      challengeServiceDescription: deal.serviceDescription,
      challengeServicePrice: deal.servicePrice,
      challengeServiceMode: deal.serviceMode,
      challengeInviterName: claimingCustomer?.name ?? null,
      usesExactReferralTracking: true,
      expiresAt: deal.expiresAt
    }
  });

  // Vincula el negocio de origen del cliente (para financiar los cupones de los
  // amigos) si aún no tenía, y marca el reto como reclamado.
  await tx.bubuiCustomer.updateMany({
    where: { id: customerId, firstBusinessId: null },
    data: { firstBusinessId: deal.businessId }
  });
  const reserved = await tx.bubuiCustomDeal.updateMany({
    where: { id: deal.id, claimedByCustomerId: null },
    data: { claimedByCustomerId: customerId, claimedAt: new Date(), offerId: created.id }
  });
  if (reserved.count !== 1) throw Object.assign(new Error("claim race"), { code: "claim_race" });
  return created;
  });

  // Aviso al DUEÑO: un cliente acaba de ACEPTAR el reto (panel + push).
  void (async () => {
    const cust = await prisma.bubuiCustomer.findUnique({
      where: { id: customerId },
      select: { name: true, phone: true }
    });
    const who = cust?.name?.trim() || cust?.phone || "Un cliente";
    await alertBusiness(deal.businessId, {
      type: "challenge_accepted",
      message: `🎯 ${who} ha aceptado tu reto: traer ${deal.friendsRequired} ${deal.friendsRequired === 1 ? "amigo" : "amigos"} para ganar ${deal.clientDiscountPct}% de descuento.`,
      pushTitle: "Reto aceptado 🎯",
      link: "/bubui/negocio"
    }).catch(() => {});
  })();

  void recordDealTrace({ token: params.token, stage: "web_claim_ok", source: "server" });
  return NextResponse.json({
    ok: true, referralCode: code, shareUrl: challengeReferralUrl(code, offer.id),
    clientDiscountPct: deal.clientDiscountPct, friendsRequired: deal.friendsRequired, friendDiscountPct: deal.friendDiscountPct
  });
}
