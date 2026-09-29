import type { BubuiPurchase } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { reevaluateChallengeAfterFriendCouponRedemption } from "./challenge-redemption";

/** Durable, idempotent post-commit work. Never changes the purchase totals. */
export async function finishPurchaseChallenge(purchase: BubuiPurchase) {
  if (purchase.status !== "confirmed" || purchase.challengeProcessedAt) return;
  if (purchase.redeemedOfferId) {
    const [offer, customer] = await Promise.all([
      prisma.bubuiOffer.findUnique({ where: { id: purchase.redeemedOfferId } }),
      prisma.bubuiCustomer.findUnique({ where: { id: purchase.customerId } })
    ]);
    if (offer && customer) await reevaluateChallengeAfterFriendCouponRedemption({
      source: offer.source, triggerBusinessId: offer.triggerBusinessId,
      friendCustomerId: purchase.customerId, businessId: purchase.businessId,
      referredById: customer.referredById, referralOfferId: customer.referralOfferId
    });
  }
  await prisma.bubuiPurchase.update({ where: { id: purchase.id }, data: { challengeProcessedAt: new Date() } });
}

export async function recoverPurchaseChallenges() {
  const purchases = await prisma.bubuiPurchase.findMany({
    where: { status: "confirmed", challengeProcessedAt: null },
    orderBy: { confirmedAt: "asc" }, take: 100
  });
  for (const purchase of purchases) {
    try { await finishPurchaseChallenge(purchase); }
    catch (error) { console.warn("[bubui challenge recovery]", purchase.id, error); }
  }
}
