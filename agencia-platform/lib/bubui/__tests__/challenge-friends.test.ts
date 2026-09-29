import { describe, expect, it } from "vitest";
import { buildChallengeFriends } from "../challenge-friends";

describe("exact challenge friends", () => {
  it("shows an existing customer in another challenge through the participant record", () => {
    const result = buildChallengeFriends("offer-b", [
      { id: "1", referralOfferId: "offer-a", name: "Ana", phone: "+34600000000", createdAt: new Date("2026-01-01"), redeemed: false },
    ], [{ offerId: "offer-b", friendCustomerId: "1", registeredAt: new Date("2026-09-29") }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ customerId: "1", phone: "+34600000000", registeredAt: "2026-09-29T00:00:00.000Z" });
  });
  it("solo muestra altas atribuidas a la oferta exacta y conserva nombre/telefono", () => {
    const result = buildChallengeFriends("offer-a", [
      { id: "1", referralOfferId: "offer-a", name: "Ana", phone: "+34600111222", createdAt: new Date("2026-08-21"), redeemed: false },
      { id: "2", referralOfferId: "offer-b", name: "Luis", phone: "+34600333444", createdAt: new Date("2026-08-21"), redeemed: true },
    ]);
    expect(result).toEqual([{ customerId: "1", name: "Ana", phone: "+34600111222", registered: true, redeemed: false, registeredAt: "2026-08-21T00:00:00.000Z" }]);
  });
});
