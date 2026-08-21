import { describe, expect, it } from "vitest";
import { buildFriendChallengeProgress, friendsForChallengeOffer } from "../friend-challenge-progress";

describe("buildFriendChallengeProgress", () => {
  it("keeps five ordered slots and distinguishes registration from coupon use", () => {
    const result = buildFriendChallengeProgress(
      [
        { id: "a", name: "Ana" },
        { id: "b", name: "Bruno" },
      ],
      new Set(["a"]),
      5
    );

    expect(result).toEqual([
      { customerId: "a", name: "Ana", initial: "A", registered: true, redeemed: true },
      { customerId: "b", name: "Bruno", initial: "B", registered: true, redeemed: false },
      { customerId: null, name: null, initial: null, registered: false, redeemed: false },
      { customerId: null, name: null, initial: null, registered: false, redeemed: false },
      { customerId: null, name: null, initial: null, registered: false, redeemed: false },
    ]);
  });

  it("never exposes more friends than the challenge requires", () => {
    const friends = Array.from({ length: 7 }, (_, i) => ({ id: String(i), name: `Friend ${i}` }));
    expect(buildFriendChallengeProgress(friends, new Set(), 5)).toHaveLength(5);
  });
});

describe("friendsForChallengeOffer", () => {
  const friends = [
    { id: "ana", name: "Ana", referralOfferId: "old-challenge" },
    { id: "bruno", name: "Bruno", referralOfferId: null },
  ];

  it("uses participant rows even when referralOfferId points to an older challenge", () => {
    expect(friendsForChallengeOffer("new-challenge", friends, [
      { offerId: "new-challenge", friendCustomerId: "ana", status: "registered", registeredAt: new Date("2026-08-21T10:00:00Z") },
    ])).toEqual([friends[0]]);
  });

  it("keeps progress independent across challenges and excludes declined friends", () => {
    const participants = [
      { offerId: "challenge-a", friendCustomerId: "ana", status: "registered", registeredAt: new Date("2026-08-21T10:00:00Z") },
      { offerId: "challenge-b", friendCustomerId: "bruno", status: "registered", registeredAt: new Date("2026-08-21T11:00:00Z") },
      { offerId: "challenge-b", friendCustomerId: "ana", status: "declined", registeredAt: new Date("2026-08-21T09:00:00Z") },
    ];
    expect(friendsForChallengeOffer("challenge-a", friends, participants).map((friend) => friend.id)).toEqual(["ana"]);
    expect(friendsForChallengeOffer("challenge-b", friends, participants).map((friend) => friend.id)).toEqual(["bruno"]);
  });

  it("falls back to referralOfferId for historical challenges without participants", () => {
    expect(friendsForChallengeOffer("old-challenge", friends, [])).toEqual([friends[0]]);
  });
});
