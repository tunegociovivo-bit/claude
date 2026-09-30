import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedMobileConnectionStep, mobileReconnectDelay } from "../mobile-connection-policy";

afterEach(() => vi.useRealTimers());

describe("USB recovery", () => {
  it("bounds repeated retries and staggers different phones", () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      expect(mobileReconnectDelay("320135531117", attempt)).toBeLessThan(33_000);
      expect(mobileReconnectDelay("320135531117", attempt)).toBeGreaterThanOrEqual(2_000);
    }
    expect(mobileReconnectDelay("320135531117", 0)).not.toBe(mobileReconnectDelay("320335538166", 0));
  });

  it("rejects a stalled connection and closes its late resource exactly once", async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const close = vi.fn(async () => undefined);
    const pending = boundedMobileConnectionStep(new Promise<string>(done => { resolve = done; }), 100, "USB", close);
    const assertion = expect(pending).rejects.toThrow("automáticamente");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    resolve("late transport");
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledExactlyOnceWith("late transport");
  });

  it("keeps a successful resource open and clears the timeout", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    await expect(boundedMobileConnectionStep(Promise.resolve("live"), 100, "USB", close)).resolves.toBe("live");
    expect(vi.getTimerCount()).toBe(0);
    expect(close).not.toHaveBeenCalled();
  });

  it("preserves the original error without a lingering timer", async () => {
    vi.useFakeTimers();
    const error = new Error("transferOut");
    await expect(boundedMobileConnectionStep(Promise.reject(error), 100, "USB")).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
