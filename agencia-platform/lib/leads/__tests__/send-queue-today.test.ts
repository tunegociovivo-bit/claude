import { describe, expect, it } from "vitest";
import { madridDayRange } from "../madrid-day";

describe("madridDayRange", () => {
  it("returns the UTC range for today's Madrid calendar day in summer", () => {
    const range = madridDayRange(new Date("2026-08-19T10:00:00.000Z"));
    expect(range.from.toISOString()).toBe("2026-08-18T22:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-08-19T22:00:00.000Z");
  });

  it("handles the 25-hour Madrid day when daylight saving time ends", () => {
    const range = madridDayRange(new Date("2026-10-25T12:00:00.000Z"));
    expect(range.from.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});
