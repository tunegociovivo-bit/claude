import { describe, expect, it } from "vitest";
import { facebookCommentTargets, parseMetaImportReferences } from "../facebook-comment-targets";

describe("Facebook comment import references", () => {
  it("retains distinct original and effective threads with the owning page token", () => {
    expect(facebookCommentTargets({ effective_object_story_id: "123_456", object_story_id: "123_789" }, new Map([["123", "page-token"]]))).toEqual([
      { id: "123_456", ownerId: "123", platform: "facebook", token: "page-token" },
      { id: "123_789", ownerId: "123", platform: "facebook", token: "page-token" },
    ]);
  });
  it("does not read a repeated story twice or mistake a bare post id for a page", () => {
    expect(facebookCommentTargets({ effective_object_story_id: "456", object_story_id: "456", object_story_spec: { page_id: "123" } }, new Map([["123", "page-token"]]))).toHaveLength(1);
    expect(facebookCommentTargets({ effective_object_story_id: "456" }, new Map([["456", "wrong-token"]]))[0].token).toBeUndefined();
  });
  it("extracts the actual dynamic post and ad separately without carrying preview tokens", () => {
    expect(parseMetaImportReferences("120224999030870524 https://www.facebook.com/100064262846488/posts/1409934984491916/?dco_ad_token=private&dco_ad_id=120224999030870524")).toEqual({
      extraAdIds: ["120224999030870524"], extraPosts: [{ adId: "120224999030870524", postId: "1409934984491916" }],
    });
  });
  it("rejects unknown or unrelated references rather than silently running a generic import", () => {
    expect(() => parseMetaImportReferences("https://example.org/123")).toThrow();
    expect(() => parseMetaImportReferences("https://www.facebook.com/123/posts/456")).toThrow();
    expect(() => parseMetaImportReferences("not-an-id")).toThrow();
  });
});
