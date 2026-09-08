import { describe, expect, it } from "vitest";
import { bankMovementInputSchema } from "../input";

describe("bank reconciliation input", () => {
  it("preserves verified SEPA identifiers sent by the local agent", () => {
    const parsed = bankMovementInputSchema.parse({
      externalId: "movement-065c",
      bookedAt: "2026-09-02T12:00:00.000Z",
      amountCents: 336267,
      remittanceNumber: "00496611753000065C",
      debtorIbanLast4: "0770"
    });

    expect(parsed.remittanceNumber).toBe("00496611753000065C");
    expect(parsed.debtorIbanLast4).toBe("0770");
  });

  it("rejects an empty or malformed remittance identifier", () => {
    expect(() => bankMovementInputSchema.parse({
      externalId: "movement-invalid",
      bookedAt: "2026-09-02T12:00:00.000Z",
      amountCents: 336267,
      remittanceNumber: "   ",
      debtorIbanLast4: "0770"
    })).toThrow();

    expect(() => bankMovementInputSchema.parse({
      externalId: "movement-too-short",
      bookedAt: "2026-09-02T12:00:00.000Z",
      amountCents: 336267,
      remittanceNumber: "A B"
    })).toThrow();
  });

  it("normalizes a Santander remittance identifier with spaces", () => {
    const movement = bankMovementInputSchema.parse({
      externalId: "movement-spaced",
      bookedAt: "2026-09-02T12:00:00.000Z",
      amountCents: 336267,
      remittanceNumber: "0049 6611 753 000065c"
    });

    expect(movement.remittanceNumber).toBe("00496611753000065C");
  });
});
