import { describe, expect, it } from "vitest";
import { challengeFriendDomId, parseChallengeFollowupTarget } from "../challenge-followup-link";

describe("challenge follow-up deep link", () => {
  it("resolves the exact challenge and friend from the notification URL", () => {
    const params = new URLSearchParams("challenge=offer-123&friend=friend-456");
    expect(parseChallengeFollowupTarget(params)).toEqual({
      offerId: "offer-123",
      friendId: "friend-456",
      domId: "challenge-friend-offer-123-friend-456",
      panelTab: "nicho",
    });
  });

  it("does not focus a partial or malformed target", () => {
    expect(parseChallengeFollowupTarget(new URLSearchParams("challenge=offer-123"))).toBeNull();
    expect(parseChallengeFollowupTarget(new URLSearchParams("challenge=../x&friend=f"))).toBeNull();
  });

  it("builds a stable safe id for the response card", () => {
    expect(challengeFriendDomId("offer_1", "friend-2")).toBe("challenge-friend-offer_1-friend-2");
  });
});
