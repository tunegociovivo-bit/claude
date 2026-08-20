import { unlockShareChallengeOffers } from "./share-offer";

export type FriendCouponRedemption = {
  source: string | null;
  referredById: string | null;
  referralOfferId: string | null;
};

/**
 * Reevalúa exclusivamente el reto que originó un cupón de amigo. Los cupones
 * normales y los referidos sin atribución exacta no pueden avanzar otro reto.
 */
export async function reevaluateChallengeAfterFriendCouponRedemption(
  redemption: FriendCouponRedemption
): Promise<number> {
  if (
    redemption.source !== "referral_welcome" ||
    !redemption.referredById ||
    !redemption.referralOfferId
  ) {
    return 0;
  }
  return unlockShareChallengeOffers(redemption.referredById, redemption.referralOfferId);
}
