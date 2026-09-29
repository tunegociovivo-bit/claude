import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const H = vi.hoisted(() => ({ unlock: vi.fn(), participant: { findFirst: vi.fn(), updateMany: vi.fn() } }));
vi.mock("../share-offer", () => ({ unlockShareChallengeOffers: H.unlock }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { bubuiChallengeParticipant: H.participant } }));

import { reevaluateChallengeAfterFriendCouponRedemption } from "../challenge-redemption";

const root = path.resolve(__dirname, "../../..");

beforeEach(() => vi.clearAllMocks());

describe("express referral coupon redemption", () => {
  it("credits the redeemed coupon's challenge instead of the customer's first referral", async () => {
    H.participant.findFirst.mockResolvedValue({ id: "participant", referrerCustomerId: "new-owner" });
    H.participant.updateMany.mockResolvedValue({ count: 1 });
    await reevaluateChallengeAfterFriendCouponRedemption({ source: "referral_welcome", referredById: "old-owner", referralOfferId: "old-challenge", triggerBusinessId: "ref:welcome:new-challenge", friendCustomerId: "friend", businessId: "business" });
    expect(H.participant.findFirst).toHaveBeenCalledWith({ where: { offerId: "new-challenge", friendCustomerId: "friend", businessId: "business" } });
    expect(H.unlock).toHaveBeenCalledWith("new-owner", "new-challenge");
    expect(H.unlock).not.toHaveBeenCalledWith("old-owner", "old-challenge");
  });
  it("does not advance an old challenge when a generic welcome coupon is redeemed", async () => {
    await reevaluateChallengeAfterFriendCouponRedemption({ source: "referral_welcome", referredById: "owner", referralOfferId: "old-challenge", triggerBusinessId: "ref:welcome", friendCustomerId: "friend", businessId: "business" });
    expect(H.unlock).not.toHaveBeenCalled();
    expect(H.participant.updateMany).not.toHaveBeenCalled();
  });
  it("reevaluates only the exact parent challenge after the friend coupon is redeemed", async () => {
    H.unlock.mockResolvedValue(1);
    await reevaluateChallengeAfterFriendCouponRedemption({
      source: "referral_welcome",
      referredById: "owner-1",
      referralOfferId: "challenge-5"
    });
    expect(H.unlock).toHaveBeenCalledOnce();
    expect(H.unlock).toHaveBeenCalledWith("owner-1", "challenge-5");
  });

  it.each([
    { source: "cross", referredById: "owner-1", referralOfferId: "challenge-5" },
    { source: "referral_welcome", referredById: null, referralOfferId: "challenge-5" },
    { source: "referral_welcome", referredById: "owner-1", referralOfferId: null }
  ])("does not credit an unrelated or unattributed redemption", async (input) => {
    await reevaluateChallengeAfterFriendCouponRedemption(input);
    expect(H.unlock).not.toHaveBeenCalled();
  });

  it("calls the behavioral helper after persisting the express redemption", () => {
    const scan = fs.readFileSync(path.join(root, "app/api/bubui/scan/route.ts"), "utf8");
    const redeemed = scan.indexOf("data: { redeemed: true");
    const reevaluate = scan.indexOf("reevaluateChallengeAfterFriendCouponRedemption", redeemed);
    expect(redeemed).toBeGreaterThan(-1);
    expect(reevaluate).toBeGreaterThan(redeemed);
  });
});
