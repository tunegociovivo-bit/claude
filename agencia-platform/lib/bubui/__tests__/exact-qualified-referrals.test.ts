import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  prisma: {
    bubuiCustomer: { findMany: vi.fn() },
    bubuiOffer: { findMany: vi.fn() },
    bubuiPurchase: { findMany: vi.fn() }
  }
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: H.prisma }));
vi.mock("@/lib/integrations/email", () => ({ sendEmail: vi.fn(), isEmailEnabled: vi.fn() }));

import { countQualifiedOfferReferrals } from "../referral";

beforeEach(() => vi.clearAllMocks());

describe("qualified referrals attributed to one challenge", () => {
  it("counts only redeemed welcome coupons belonging to exact attributed friends", async () => {
    H.prisma.bubuiCustomer.findMany.mockResolvedValue([{ id: "friend-a" }, { id: "friend-b" }]);
    H.prisma.bubuiOffer.findMany.mockResolvedValue([
      { id: "welcome-a", customerId: "friend-a" },
      { id: "welcome-b", customerId: "friend-b" }
    ]);
    H.prisma.bubuiPurchase.findMany.mockResolvedValue([{ redeemedOfferId: "welcome-a" }]);

    expect(await countQualifiedOfferReferrals("owner-1", "challenge-5", "biz-1")).toBe(1);
    expect(H.prisma.bubuiOffer.findMany).toHaveBeenCalledWith({
      where: {
        businessId: "biz-1",
        source: "referral_welcome",
        triggerBusinessId: "ref:welcome:challenge-5"
      },
      select: { id: true, customerId: true }
    });
    expect(H.prisma.bubuiCustomer.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["friend-a", "friend-b"] },
        referredById: "owner-1",
        phoneVerified: true
      },
      select: { id: true }
    });
    expect(H.prisma.bubuiPurchase.findMany).toHaveBeenCalledWith({
      where: { status: "confirmed", redeemedOfferId: { in: ["welcome-a", "welcome-b"] } },
      select: { redeemedOfferId: true },
      distinct: ["redeemedOfferId"]
    });
  });

  it("does not count purchases when this challenge has no attributed friends", async () => {
    H.prisma.bubuiOffer.findMany.mockResolvedValue([]);
    expect(await countQualifiedOfferReferrals("owner-1", "challenge-empty", "biz-1")).toBe(0);
    expect(H.prisma.bubuiCustomer.findMany).not.toHaveBeenCalled();
    expect(H.prisma.bubuiPurchase.findMany).not.toHaveBeenCalled();
  });
});
