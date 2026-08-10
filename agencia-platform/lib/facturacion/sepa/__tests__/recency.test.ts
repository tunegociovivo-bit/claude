import { describe, expect, it } from "vitest";
import { madridBusinessDayWindow, startOfMadridBusinessDay } from "../recency";

describe("startOfMadridBusinessDay", () => {
  it("uses summer time when calculating today's boundary", () => {
    expect(startOfMadridBusinessDay(new Date("2026-08-10T06:00:00Z")).toISOString()).toBe("2026-08-09T22:00:00.000Z");
  });

  it("uses winter time when calculating today's boundary", () => {
    expect(startOfMadridBusinessDay(new Date("2026-01-10T06:00:00Z")).toISOString()).toBe("2026-01-09T23:00:00.000Z");
  });

  it("keeps the previous Madrid day before local midnight", () => {
    expect(startOfMadridBusinessDay(new Date("2026-08-09T21:30:00Z")).toISOString()).toBe("2026-08-08T22:00:00.000Z");
  });
});

describe("madridBusinessDayWindow", () => {
  it("bounds today and excludes future-dated invoices", () => {
    const window = madridBusinessDayWindow(new Date("2026-08-10T06:00:00Z"));
    expect(window.start.toISOString()).toBe("2026-08-09T22:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-08-10T22:00:00.000Z");
  });

  it("supports one recovery day and DST boundaries", () => {
    const window = madridBusinessDayWindow(new Date("2026-03-29T12:00:00Z"), 1);
    expect(window.start.toISOString()).toBe("2026-03-27T23:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });
});
