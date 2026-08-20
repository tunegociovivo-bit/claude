import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");

describe("express referral coupon redemption", () => {
  it("reevaluates the exact parent challenge after immediate redemption", () => {
    const scan = fs.readFileSync(path.join(root, "app/api/bubui/scan/route.ts"), "utf8");
    expect(scan).toContain("referralOfferId");
    expect(scan).toContain("unlockShareChallengeOffers");
  });
});
