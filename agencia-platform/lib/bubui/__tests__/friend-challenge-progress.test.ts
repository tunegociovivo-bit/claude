import { describe, expect, it } from "vitest";
import { buildFriendChallengeProgress } from "../friend-challenge-progress";

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
