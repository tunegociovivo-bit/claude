import { describe, expect, it } from "vitest";
import { initialOnboardingStep, canExploreAsGuest } from "../onboarding-entry";

describe("Android onboarding entry", () => {
  it("takes a fresh Android install directly to customer registration", () => {
    expect(initialOnboardingStep("android", false)).toBe(2);
  });

  it("never offers guest mode on Android when referral recovery may be needed", () => {
    expect(canExploreAsGuest("android", false)).toBe(false);
    expect(canExploreAsGuest("android", true)).toBe(false);
  });

  it("keeps the existing iOS entry unless an invitation is pending", () => {
    expect(initialOnboardingStep("ios", false)).toBe(0);
    expect(canExploreAsGuest("ios", false)).toBe(true);
    expect(canExploreAsGuest("ios", true)).toBe(false);
  });
});
