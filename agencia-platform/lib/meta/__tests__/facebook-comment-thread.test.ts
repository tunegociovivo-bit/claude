import { describe, expect, it, vi } from "vitest";
import { readFacebookCommentThread } from "../facebook-comment-thread";

describe("complete Facebook threads", () => {
  it("keeps recent replies to old parents and does not send date filters to Meta", async () => {
    const read = vi.fn().mockResolvedValue([{ id: "old", created_time: "2025-01-01", comments: { data: [{ id: "recent", created_time: "2026-09-08" }] } }]);
    const comments = await readFacebookCommentThread("123_456", read);
    expect(comments.map((comment) => comment.id)).toEqual(["old", "recent"]);
    expect(comments[1].parent).toEqual({ id: "old" });
    expect(read.mock.calls[0][0]).toContain("filter=toplevel");
    expect(read.mock.calls[0][0]).not.toMatch(/since=|until=/);
  });
  it("exhausts reply pagination and deduplicates replies already returned by Meta", async () => {
    const read = vi.fn().mockResolvedValueOnce([{ id: "parent", comments: { data: [{ id: "r1" }], paging: { next: "next" } } }])
      .mockResolvedValueOnce([{ id: "r1" }, { id: "r2" }, { id: "r2" }]);
    expect((await readFacebookCommentThread("123_456", read)).map((comment) => comment.id)).toEqual(["parent", "r1", "r2"]);
    expect(read.mock.calls[1][0]).toMatch(/^parent\/comments\?/);
  });
  it("does not report a partial thread as complete when fetching replies fails", async () => {
    const read = vi.fn().mockResolvedValueOnce([{ id: "parent", comments: { paging: { next: "next" } } }]).mockRejectedValueOnce(new Error("Meta unavailable"));
    await expect(readFacebookCommentThread("123_456", read)).rejects.toThrow("Meta unavailable");
  });
});
