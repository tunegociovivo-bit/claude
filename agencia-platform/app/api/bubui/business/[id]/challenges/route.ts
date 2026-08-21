/**
 * GET /api/bubui/business/[id]/challenges
 *
 * Lista los clientes con un RETO en marcha (oferta share_challenge bloqueada,
 * sin caducar) de este negocio, con su progreso (amigos traídos / requeridos)
 * y su caducidad. Para el panel "Retos activos" del comercio.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { countVerifiedReferrals, countQualifiedReferrals } from "@/lib/bubui/referral";
import { sharesLeft } from "@/lib/bubui/share-offer";
import { buildChallengeFriends } from "@/lib/bubui/challenge-friends";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }

  const offers = await prisma.bubuiOffer.findMany({
    where: {
      businessId: params.id,
      source: "share_challenge",
      active: false,
      redeemed: false,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  const custIds = [...new Set(offers.map((o) => o.customerId))];
  const customers = await prisma.bubuiCustomer.findMany({
    where: { id: { in: custIds } },
    select: { id: true, name: true, phone: true }
  });
  const cmap = new Map(customers.map((c) => [c.id, c]));
  const exactFriends = await prisma.bubuiCustomer.findMany({
    where: { referralOfferId: { in: offers.map((offer) => offer.id) }, phoneVerified: true },
    select: { id: true, name: true, phone: true, createdAt: true, referralOfferId: true }
  });
  const friendPurchases = await prisma.bubuiPurchase.findMany({
    where: {
      businessId: params.id,
      customerId: { in: exactFriends.map((friend) => friend.id) },
      status: "confirmed",
      redeemedOfferId: { not: null }
    },
    select: { customerId: true }
  });
  const redeemedIds = new Set(friendPurchases.map((purchase) => purchase.customerId));
  const participants = await prisma.bubuiChallengeParticipant.findMany({
    where: { offerId: { in: offers.map((offer) => offer.id) } },
    select: { offerId: true, friendCustomerId: true, status: true, nextFollowupAt: true, reminderSentAt: true }
  });

  const items = await Promise.all(
    offers.map(async (o) => {
      const friends = o.usesExactReferralTracking
        ? buildChallengeFriends(o.id, exactFriends.map((friend) => ({ ...friend, redeemed: redeemedIds.has(friend.id) })))
            .map((friend) => {
              const participant = participants.find((row) => row.offerId === o.id && row.friendCustomerId === friend.customerId);
              return { ...friend, redeemed: friend.redeemed || participant?.status === "confirmed", status: participant?.status ?? "registered", nextFollowupAt: participant?.nextFollowupAt?.toISOString() ?? null, reminderSentAt: participant?.reminderSentAt?.toISOString() ?? null };
            })
            .filter((friend) => !["declined", "lost"].includes(friend.status))
        : [];
      const exactDone = o.unlockRequiresPurchase ? friends.filter((friend) => friend.redeemed).length : friends.length;
      const verified = o.usesExactReferralTracking ? exactDone : (o.unlockRequiresPurchase
        ? await countQualifiedReferrals(o.customerId, params.id)
        : await countVerifiedReferrals(o.customerId));
      const left = o.usesExactReferralTracking
        ? Math.max(0, o.unlockShares - verified)
        : sharesLeft({ unlockBaseline: o.unlockBaseline, unlockShares: o.unlockShares }, verified);
      const done = o.usesExactReferralTracking ? Math.min(o.unlockShares, verified) : Math.max(0, Math.min(o.unlockShares, verified - o.unlockBaseline));
      const c = cmap.get(o.customerId);
      return {
        offerId: o.id,
        customerId: o.customerId,
        name: c?.name ?? null,
        phone: c?.phone ?? null,
        discountPct: o.discountPct,
        rewardLabel: o.rewardLabel,
        need: o.unlockShares,
        done,
        left,
        requiresPurchase: o.unlockRequiresPurchase,
        expiresAt: o.expiresAt.toISOString(),
        createdAt: o.createdAt.toISOString(),
        friends
      };
    })
  );

  return NextResponse.json({ items });
}
