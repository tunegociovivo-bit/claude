import { unlockShareChallengeOffers } from "./share-offer";
import { prisma } from "@/lib/db/prisma";

export type FriendCouponRedemption = {
  source: string | null;
  referredById: string | null;
  referralOfferId: string | null;
  triggerBusinessId?: string | null;
  friendCustomerId?: string;
  businessId?: string;
};

/**
 * Reevalúa exclusivamente el reto que originó un cupón de amigo. Los cupones
 * normales y los referidos sin atribución exacta no pueden avanzar otro reto.
 */
export async function reevaluateChallengeAfterFriendCouponRedemption(
  redemption: FriendCouponRedemption
): Promise<number> {
  if (redemption.source !== "referral_welcome") return 0;
  if (redemption.triggerBusinessId !== undefined) {
    if (!redemption.triggerBusinessId?.startsWith("ref:welcome:") || !redemption.friendCustomerId || !redemption.businessId) return 0;
    const offerId = redemption.triggerBusinessId.slice("ref:welcome:".length);
    const participant = await prisma.bubuiChallengeParticipant.findFirst({
      where: { offerId, friendCustomerId: redemption.friendCustomerId, businessId: redemption.businessId }
    });
    if (!participant || ["declined", "lost"].includes(participant.status)) return 0;
    await prisma.bubuiChallengeParticipant.updateMany({
      where: { id: participant.id, status: { notIn: ["confirmed", "declined", "lost"] } },
      data: { status: "confirmed", decidedAt: new Date(), nextFollowupAt: null }
    });
    await prisma.bubuiChallengeParticipant.updateMany({
      where: { id: participant.id, contactedAt: null },
      data: { contactedAt: new Date(), contactChannel: "qr" }
    });
    return unlockShareChallengeOffers(participant.referrerCustomerId, offerId);
  }
  if (
    redemption.source !== "referral_welcome" ||
    !redemption.referredById ||
    !redemption.referralOfferId
  ) {
    return 0;
  }
  return unlockShareChallengeOffers(redemption.referredById, redemption.referralOfferId);
}
