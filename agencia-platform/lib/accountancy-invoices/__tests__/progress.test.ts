import { describe, expect, it } from "vitest";
import { getAccountancyRunProgress } from "../progress";

describe("getAccountancyRunProgress", () => {
  it("reports completed accounts, percentage and a bounded ETA", () => {
    const progress = getAccountancyRunProgress({
      createdAt: "2026-09-09T10:00:00.000Z",
      items: [
        { status: "DOWNLOADED" },
        { status: "FAILED" },
        { status: "RUNNING" },
        { status: "PENDING" },
      ],
    }, new Date("2026-09-09T10:02:00.000Z"));
    expect(progress).toEqual({ completed: 2, total: 4, percent: 50, etaMinutes: 2 });
  });

  it("returns zero ETA when the run is complete", () => {
    expect(getAccountancyRunProgress({ createdAt: "2026-09-09T10:00:00.000Z", items: [{ status: "DOWNLOADED" }] }, new Date("2026-09-09T10:01:00.000Z")).etaMinutes).toBe(0);
  });
});
