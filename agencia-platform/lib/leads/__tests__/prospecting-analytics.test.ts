import { describe, expect, it } from "vitest";
import { buildProspectingConversion } from "@/lib/leads/prospecting-analytics";

describe("prospecting conversion analytics", () => {
  it("builds a cumulative funnel without counting won prospects twice", () => {
    const conversion = buildProspectingConversion([
      { id: "new", status: "pending", lastContactedAt: null, repliedAt: null },
      { id: "sent", status: "active", lastContactedAt: new Date(), repliedAt: null },
      { id: "reply", status: "replied", lastContactedAt: new Date(), repliedAt: new Date() },
      { id: "meeting", status: "meeting", lastContactedAt: new Date(), repliedAt: new Date() },
      { id: "won", status: "completed", lastContactedAt: new Date(), repliedAt: new Date() }
    ], ["won", "won"]);
    expect(conversion).toMatchObject({ total: 5, contacted: 4, replied: 3, qualified: 2, meetings: 2, won: 1 });
    expect(conversion.replyRate).toBe(75);
    expect(conversion.winRate).toBe(50);
  });

  it("returns zero rates when there is no denominator", () => {
    expect(buildProspectingConversion([], [])).toMatchObject({ replyRate: 0, qualificationRate: 0, meetingRate: 0, winRate: 0 });
  });

  it("keeps the funnel cumulative when a downstream outcome was imported", () => {
    const conversion = buildProspectingConversion([
      { id: "won", status: "completed", lastContactedAt: null, repliedAt: null }
    ], ["won"]);
    expect(conversion).toMatchObject({ contacted: 1, replied: 1, qualified: 1, meetings: 1, won: 1 });
    expect(conversion.replyRate).toBeLessThanOrEqual(100);
  });
});
