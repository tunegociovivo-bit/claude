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
    expect(progress).toEqual({ completed: 2, total: 4, percent: 50, etaMinutes: 2, waitingForMetaAgent: false });
  });

  it("reports that the run is waiting for the Meta browser agent", () => {
    const progress = getAccountancyRunProgress({
      createdAt: "2026-09-09T10:00:00.000Z",
      items: [
        { status: "DOWNLOADED", source: "HOLDED" },
        { status: "FAILED", source: "GOOGLE_ADS" },
        { status: "PENDING", source: "META" },
        { status: "PENDING", source: "META" },
      ],
    }, new Date("2026-09-09T11:00:00.000Z"));

    expect(progress.waitingForMetaAgent).toBe(true);
    expect(progress.etaMinutes).toBeNull();
  });

  it("returns zero ETA when the run is complete", () => {
    expect(getAccountancyRunProgress({ createdAt: "2026-09-09T10:00:00.000Z", items: [{ status: "DOWNLOADED" }] }, new Date("2026-09-09T10:01:00.000Z")).etaMinutes).toBe(0);
  });
});
