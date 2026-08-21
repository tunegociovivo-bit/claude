export type BusinessDealContext = {
  businessName: string;
  clientDiscountPct: number;
  title: string | null;
};

export type FriendInviteContext = {
  businessName: string;
  friendDiscountPct: number;
  friendTitle: string | null;
};

export type RegistrationChallengeContext = {
  businessName: string;
  discountPct: number;
  title: string | null;
  kind: "business-deal" | "friend-invite";
};

/** A direct business challenge always wins over a stale friend invitation. */
export function registrationChallengeContext(
  deal: BusinessDealContext | null,
  invite: FriendInviteContext | null,
  dealCaptureResolved: boolean
): RegistrationChallengeContext | null {
  if (deal) {
    return {
      businessName: deal.businessName,
      discountPct: deal.clientDiscountPct,
      title: deal.title,
      kind: "business-deal",
    };
  }
  if (!dealCaptureResolved || !invite) return null;
  return {
    businessName: invite.businessName,
    discountPct: invite.friendDiscountPct,
    title: invite.friendTitle,
    kind: "friend-invite",
  };
}
