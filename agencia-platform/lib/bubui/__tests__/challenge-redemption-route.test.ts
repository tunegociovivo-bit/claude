import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const H = vi.hoisted(() => ({ unlock: vi.fn() }));
vi.mock("../share-offer", () => ({ unlockShareChallengeOffers: H.unlock }));

import { reevaluateChallengeAfterFriendCouponRedemption } from "../challenge-redemption";

const root = path.resolve(__dirname, "../../..");

beforeEach(() => vi.clearAllMocks());

describe("express referral coupon redemption", () => {
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
    const reevaluate = scan.indexOf("reevaluateChallengeAfterFriendCouponRedemption");
    expect(redeemed).toBeGreaterThan(-1);
    expect(reevaluate).toBeGreaterThan(redeemed);
  });
});
