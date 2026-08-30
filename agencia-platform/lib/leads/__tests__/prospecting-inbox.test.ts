import { describe, expect, it } from "vitest";
import { inboxMessageId, splitInboxMessageIds } from "@/lib/leads/prospecting-inbox";

describe("prospecting inbox message ids", () => {
  it("separates and deduplicates ids by their backing store", () => {
    expect(splitInboxMessageIds([
      inboxMessageId("prospecting", "p1"),
      inboxMessageId("lead-inbox", "w1"),
      inboxMessageId("prospecting", "p1")
    ])).toEqual({ prospecting: ["p1"], leadInbox: ["w1"] });
  });

  it("ignores malformed and unknown ids", () => {
    expect(splitInboxMessageIds(["raw-id", "unknown:x", "prospecting:", ":x"]))
      .toEqual({ prospecting: [], leadInbox: [] });
  });
});
