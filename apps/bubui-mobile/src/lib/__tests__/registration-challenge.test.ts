import { describe, expect, it } from "vitest";
import { registrationChallengeContext } from "../registration-challenge";

describe("registrationChallengeContext", () => {
  it("always gives the direct business deal priority over a stale friend invite", () => {
    expect(registrationChallengeContext(
      { businessName: "Roman Trainer", clientDiscountPct: 30, title: "Entrenamiento" },
      { businessName: "Roman Trainer", friendDiscountPct: 16, friendTitle: "Entrenamiento" },
      true
    )).toMatchObject({ kind: "business-deal", discountPct: 30 });
  });

  it("does not flash a stale friend percentage while deal capture is pending", () => {
    expect(registrationChallengeContext(
      null,
      { businessName: "Roman Trainer", friendDiscountPct: 16, friendTitle: null },
      false
    )).toBeNull();
  });

  it("uses the friend discount when there is no direct business deal", () => {
    expect(registrationChallengeContext(
      null,
      { businessName: "Roman Trainer", friendDiscountPct: 16, friendTitle: null },
      true
    )).toMatchObject({ kind: "friend-invite", discountPct: 16 });
  });
});
