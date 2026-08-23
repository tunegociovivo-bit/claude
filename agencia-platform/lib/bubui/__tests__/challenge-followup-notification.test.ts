import { describe, expect, it } from "vitest";
import { challengeNotificationDestination } from "../challenge-followup-notification";

describe("challenge follow-up notification action", () => {
  it("opens the active challenges area for legacy follow-up notifications", () => {
    expect(challengeNotificationDestination("challenge_followup")).toEqual({
      panelTab: "nicho",
      anchor: "retos-activos"
    });
  });

  it("does not turn unrelated news into challenge actions", () => {
    expect(challengeNotificationDestination("ranking_winner")).toBeNull();
  });
});
