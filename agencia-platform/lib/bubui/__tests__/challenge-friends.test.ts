import { describe, expect, it } from "vitest";
import { buildChallengeFriends } from "../challenge-friends";

describe("exact challenge friends", () => {
  it("solo muestra altas atribuidas a la oferta exacta y conserva nombre/telefono", () => {
    const result = buildChallengeFriends("offer-a", [
      { id: "1", referralOfferId: "offer-a", name: "Ana", phone: "+34600111222", createdAt: new Date("2026-08-21"), redeemed: false },
      { id: "2", referralOfferId: "offer-b", name: "Luis", phone: "+34600333444", createdAt: new Date("2026-08-21"), redeemed: true },
    ]);
    expect(result).toEqual([{ customerId: "1", name: "Ana", phone: "+34600111222", registered: true, redeemed: false, registeredAt: "2026-08-21T00:00:00.000Z" }]);
  });
});
