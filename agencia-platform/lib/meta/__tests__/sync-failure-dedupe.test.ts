import { describe, expect, it } from "vitest";
import { isMetaTransientCapacityError, metaSyncAlertLeaseName, metaSyncErrorFingerprint, reduceMetaRequestPath, shouldNotifyMetaSyncFailure } from "@/lib/meta/comments";

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

  it("reduces both page and nested edge limits after Meta rejects a large response", () => {
    expect(reduceMetaRequestPath("123/comments?fields=id,comments.limit(100){id,message}&limit=100"))
      .toBe("123/comments?fields=id,comments.limit(25){id,message}&limit=25");
    expect(reduceMetaRequestPath("123/ads?fields=id,name&limit=10"))
      .toBe("123/ads?fields=id,name&limit=10");
  });

  it("defers capacity errors without treating permission errors as transient", () => {
    expect(isMetaTransientCapacityError({ status: 500, message: "Please reduce the amount of data you're asking for" })).toBe(true);
    expect(isMetaTransientCapacityError({ status: 403, code: 4, message: "Application request limit reached" })).toBe(true);
    expect(isMetaTransientCapacityError({ status: 400, message: "Missing permission" })).toBe(false);
  });

  it("uses the normalized error fingerprint for a stable cross-process alert lease", () => {
    expect(metaSyncAlertLeaseName("feed-1", "Meta 500 en 123456789/comments: Please reduce the amount of data"))
      .toBe(metaSyncAlertLeaseName("feed-1", "Meta 500 en 987654321/comments: Please reduce the amount of data"));
  });
});
