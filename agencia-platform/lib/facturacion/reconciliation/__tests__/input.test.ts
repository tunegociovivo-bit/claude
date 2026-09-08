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
});
