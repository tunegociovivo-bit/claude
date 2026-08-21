export type FriendProgress = {
  customerId: string | null;
  name: string | null;
  initial: string | null;
  registered: boolean;
  redeemed: boolean;
};

export function friendCouponPresentation(source?: string | null) {
  const isFriendCoupon = source === "referral_welcome";
  return {
    isFriendCoupon,
    eyebrow: isFriendCoupon ? "UN AMIGO TE HA ENVIADO ESTE CUPÓN" : "",
    message: isFriendCoupon
      ? "Canjéalo en el negocio. Cuando lo uses, tu amigo avanzará en su reto y los dos ganaréis descuentos."
      : "",
  };
}

export function friendCouponDestination(source?: string | null): "FriendChallengeDetail" | "Negocio" {
  return source === "referral_welcome" ? "FriendChallengeDetail" : "Negocio";
}

export function friendSlotState(progress?: Partial<FriendProgress>): "empty" | "half" | "complete" {
  if (progress?.redeemed) return "complete";
  if (progress?.registered) return "half";
  return "empty";
}
