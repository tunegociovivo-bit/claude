import { describe, expect, it } from "vitest";
import { metaSyncErrorFingerprint, shouldNotifyMetaSyncFailure } from "@/lib/meta/comments";

describe("Meta sync failure alert deduplication", () => {
  const now = new Date("2026-08-25T10:00:00.000Z");

  it("normalizes campaign ids in otherwise identical Graph errors", () => {
    expect(metaSyncErrorFingerprint("Meta 500 en 120234236038230145/ads: Please reduce the amount of data"))
      .toBe(metaSyncErrorFingerprint("Meta 500 en 120247270045340145/ads: Please reduce the amount of data"));
  });

  it("suppresses the same recent failure but allows a new kind of failure", () => {
    const previous = {
      lastError: "Meta 500 en 120234236038230145/ads: Please reduce the amount of data",
      lastSyncAt: new Date("2026-08-25T09:00:00.000Z")
    };
    expect(shouldNotifyMetaSyncFailure(previous, "Meta 500 en 120247270045340145/ads: Please reduce the amount of data", now)).toBe(false);
    expect(shouldNotifyMetaSyncFailure(previous, "Meta 403 en 120247270045340145/ads: Missing permission", now)).toBe(true);
  });

  it("sends a reminder when the same failure remains after six hours", () => {
    const previous = {
      lastError: "Meta 500 en 120234236038230145/ads: Please reduce the amount of data",
      lastSyncAt: new Date("2026-08-25T03:00:00.000Z")
    };
    expect(shouldNotifyMetaSyncFailure(previous, previous.lastError, now)).toBe(true);
  });
});
