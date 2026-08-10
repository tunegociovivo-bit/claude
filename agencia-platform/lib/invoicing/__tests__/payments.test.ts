import { describe, expect, it } from "vitest";
import { derivePaymentState, validatePaymentAmount } from "../payments";

describe("derivePaymentState", () => {
  it("keeps an invoice issued after a partial payment", () => {
    expect(derivePaymentState(10_000, 2_500)).toEqual({ paidCents: 2_500, status: "ISSUED", paidAt: null });
  });

  it("marks it paid when the ledger reaches the invoice total", () => {
    const paidAt = new Date("2026-08-09T12:00:00Z");
    expect(derivePaymentState(10_000, 10_000, paidAt)).toEqual({ paidCents: 10_000, status: "PAID", paidAt });
  });

  it("clamps reversals and overpayments to valid invoice balances", () => {
    expect(derivePaymentState(10_000, -500).paidCents).toBe(0);
    expect(derivePaymentState(10_000, 12_000).paidCents).toBe(10_000);
  });
});

describe("validatePaymentAmount", () => {
  it("rejects zero, negative values and overpayments", () => {
    expect(validatePaymentAmount(0, 5_000)).toBeTruthy();
    expect(validatePaymentAmount(-1, 5_000)).toBeTruthy();
    expect(validatePaymentAmount(5_001, 5_000)).toBeTruthy();
  });

  it("accepts a payment up to the outstanding balance", () => {
    expect(validatePaymentAmount(5_000, 5_000)).toBeNull();
    expect(validatePaymentAmount(1, 5_000)).toBeNull();
  });
});
