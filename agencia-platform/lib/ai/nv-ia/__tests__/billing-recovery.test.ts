import { describe, expect, it } from "vitest";
import { isRecoverableAnthropicBillingFailure } from "../billing-recovery";

describe("isRecoverableAnthropicBillingFailure", () => {
  it("recognizes Anthropic credit failures promoted for human review", () => {
    expect(
      isRecoverableAnthropicBillingFailure({
        status: "REQUIRES_HUMAN",
        error: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing."
      })
    ).toBe(true);
  });

  it("recognizes failed runs that ask to purchase credits", () => {
    expect(
      isRecoverableAnthropicBillingFailure({
        status: "FAILED",
        error: "Please upgrade or purchase credits"
      })
    ).toBe(true);
  });

  it("does not retry unrelated or active failures", () => {
    expect(isRecoverableAnthropicBillingFailure({ status: "FAILED", error: "timeout" })).toBe(false);
    expect(
      isRecoverableAnthropicBillingFailure({
        status: "RUNNING",
        error: "Your credit balance is too low"
      })
    ).toBe(false);
  });
});
