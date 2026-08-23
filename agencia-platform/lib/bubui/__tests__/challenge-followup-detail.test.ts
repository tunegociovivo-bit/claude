import { describe, expect, it } from "vitest";
import { buildChallengeFollowupDetail } from "../challenge-followup-detail";

describe("buildChallengeFollowupDetail", () => {
  it("builds the exact commercial summary for the friend", () => {
    expect(buildChallengeFollowupDetail({ originalPrice: 250, discountPct: 16 })).toEqual({
      originalPrice: 250,
      discountPct: 16,
      savings: 40,
      finalPrice: 210,
    });
  });

  it("does not invent monetary values without a price", () => {
    expect(buildChallengeFollowupDetail({ originalPrice: null, discountPct: 16 })).toEqual({
      originalPrice: null,
      discountPct: 16,
      savings: null,
      finalPrice: null,
    });
  });
});
