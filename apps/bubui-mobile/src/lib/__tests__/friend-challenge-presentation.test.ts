import { describe, expect, it } from "vitest";
import { friendCouponPresentation, friendSlotState } from "../friend-challenge-presentation";

describe("friend challenge presentation", () => {
  it("identifies referral welcome offers as a coupon sent by a friend", () => {
    expect(friendCouponPresentation("referral_welcome")).toEqual({
      isFriendCoupon: true,
      eyebrow: "UN AMIGO TE HA ENVIADO ESTE CUPÓN",
      message: "Canjéalo en el negocio. Cuando lo uses, tu amigo avanzará en su reto y los dos ganaréis descuentos.",
    });
  });

  it("does not relabel ordinary offers", () => {
    expect(friendCouponPresentation("cross").isFriendCoupon).toBe(false);
  });

  it("renders registered friends as half complete and purchasers as complete", () => {
    expect(friendSlotState({ registered: true, redeemed: false })).toBe("half");
    expect(friendSlotState({ registered: true, redeemed: true })).toBe("complete");
    expect(friendSlotState(undefined)).toBe("empty");
  });
});
