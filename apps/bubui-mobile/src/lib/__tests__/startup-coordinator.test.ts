import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStartupRoute } from "../startup-coordinator";

describe("resolveStartupRoute", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never leaves the app on the splash when session storage stalls", async () => {
    vi.useFakeTimers();
    const result = resolveStartupRoute({
      checkSession: () => new Promise(() => {}),
      waitForDealCapture: async () => {},
      waitForReferralCapture: async () => {},
      getPendingDeal: async () => null,
      deadlineMs: 4_000
    });

    await vi.advanceTimersByTimeAsync(4_000);

    await expect(result).resolves.toMatchObject({ route: "Onboarding", timedOut: true });
  });

  it("never leaves the app on the splash when pending-deal storage stalls", async () => {
    vi.useFakeTimers();
    const result = resolveStartupRoute({
      checkSession: async () => null,
      waitForDealCapture: async () => {},
      waitForReferralCapture: async () => {},
      getPendingDeal: () => new Promise(() => {}),
      deadlineMs: 4_000
    });

    await vi.advanceTimersByTimeAsync(4_000);

    await expect(result).resolves.toMatchObject({ route: "Onboarding", timedOut: true });
  });

  it("keeps a valid signed-in session on the Feed", async () => {
    const result = await resolveStartupRoute({
      checkSession: async () => ({ customerId: "customer-1" }),
      waitForDealCapture: async () => {},
      waitForReferralCapture: async () => {},
      getPendingDeal: async () => "deal-token",
      deadlineMs: 4_000
    });

    expect(result).toEqual({
      route: "Feed",
      session: { customerId: "customer-1" },
      pendingDeal: "deal-token",
      timedOut: false
    });
  });

  it("continues to onboarding when a startup dependency rejects", async () => {
    const result = await resolveStartupRoute({
      checkSession: async () => {
        throw new Error("storage unavailable");
      },
      waitForDealCapture: async () => {},
      waitForReferralCapture: async () => {},
      getPendingDeal: async () => null,
      deadlineMs: 4_000
    });

    expect(result).toMatchObject({ route: "Onboarding", timedOut: false });
  });

  it("preserves a recovered session when referral capture stalls", async () => {
    vi.useFakeTimers();
    const result = resolveStartupRoute({
      checkSession: async () => ({ customerId: "customer-1" }),
      waitForDealCapture: async () => {},
      waitForReferralCapture: () => new Promise(() => {}),
      getPendingDeal: async () => null,
      deadlineMs: 4_000
    });

    await vi.advanceTimersByTimeAsync(4_000);

    await expect(result).resolves.toEqual({
      route: "Feed",
      session: { customerId: "customer-1" },
      pendingDeal: null,
      timedOut: true
    });
  });

  it("preserves a recovered session when an auxiliary dependency rejects", async () => {
    const result = await resolveStartupRoute({
      checkSession: async () => ({ customerId: "customer-1" }),
      waitForDealCapture: async () => {},
      waitForReferralCapture: async () => {
        throw new Error("referrer unavailable");
      },
      getPendingDeal: async () => null,
      deadlineMs: 4_000
    });

    expect(result).toEqual({
      route: "Feed",
      session: { customerId: "customer-1" },
      pendingDeal: null,
      timedOut: false
    });
  });

  it("does not let late hydration replace the route chosen at the deadline", async () => {
    vi.useFakeTimers();
    let finishReferral!: () => void;
    const referral = new Promise<void>((resolve) => {
      finishReferral = resolve;
    });
    const resultPromise = resolveStartupRoute({
      checkSession: async () => ({ customerId: "customer-1" }),
      waitForDealCapture: async () => {},
      waitForReferralCapture: () => referral,
      getPendingDeal: async () => "late-deal",
      deadlineMs: 4_000
    });

    await vi.advanceTimersByTimeAsync(4_000);
    const resultAtDeadline = await resultPromise;
    finishReferral();
    await Promise.resolve();

    expect(resultAtDeadline).toEqual({
      route: "Feed",
      session: { customerId: "customer-1" },
      pendingDeal: null,
      timedOut: true
    });
    await expect(resultPromise).resolves.toBe(resultAtDeadline);
  });
});
