import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  verified: 0,
  prisma: {
    bubuiOffer: { findMany: vi.fn(), updateMany: vi.fn() }
  },
  notify: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: H.prisma }));
vi.mock("../referral", () => ({
  countVerifiedReferrals: vi.fn(async () => H.verified),
  countQualifiedReferrals: vi.fn()
}));
vi.mock("../notify", () => ({ notifyBubuiCustomer: H.notify }));

import { unlockShareChallengeOffers } from "../share-offer";

const OFFER = {
  id: "offer-challenge-123",
  customerId: "owner-1",
  businessId: "biz-1",
  source: "share_challenge",
  active: false,
  redeemed: false,
  unlockBaseline: 0,
  unlockShares: 5,
  unlockRequiresPurchase: false,
  rewardLabel: null,
  discountPct: 30,
  business: { name: "Roman Trainer" }
};

beforeEach(() => {
  vi.clearAllMocks();
  H.verified = 0;
  H.prisma.bubuiOffer.findMany.mockResolvedValue([OFFER]);
  H.prisma.bubuiOffer.updateMany.mockResolvedValue({ count: 1 });
});

describe("reto de cinco amigos", () => {
  it("sigue bloqueado con los cuatro primeros y se activa exactamente con el quinto", async () => {
    for (let uniqueFriends = 1; uniqueFriends <= 4; uniqueFriends++) {
      H.verified = uniqueFriends;
      expect(await unlockShareChallengeOffers("owner-1", OFFER.id)).toBe(0);
    }
    expect(H.prisma.bubuiOffer.updateMany).not.toHaveBeenCalled();

    H.verified = 5;
    expect(await unlockShareChallengeOffers("owner-1", OFFER.id)).toBe(1);
    expect(H.prisma.bubuiOffer.updateMany).toHaveBeenCalledTimes(1);
    expect(H.prisma.bubuiOffer.updateMany).toHaveBeenCalledWith({
      where: { id: OFFER.id, active: false },
      data: { active: true }
    });
  });

  it("una carrera posterior no vuelve a activar ni notificar", async () => {
    H.verified = 5;
    H.prisma.bubuiOffer.updateMany.mockResolvedValue({ count: 0 });
    expect(await unlockShareChallengeOffers("owner-1", OFFER.id)).toBe(0);
    expect(H.notify).not.toHaveBeenCalled();
  });
});
