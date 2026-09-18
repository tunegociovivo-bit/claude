import { describe, expect, it } from "vitest";
import { addFacebookReviewLinks, facebookKeywordReviewItem, normalizeFacebookReviewUrl, parseFacebookReviewQueue } from "../facebook-review-queue";

describe("Facebook review queue", () => {
  it("deduplicates mobile links and tracking parameters without losing post identifiers", () => {
    const result = addFacebookReviewLinks([], "https://m.facebook.com/story.php?story_fbid=12&id=34&fbclid=tracking\nhttps://www.facebook.com/story.php?id=34&story_fbid=12");
    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.items[0]?.url).toBe("https://www.facebook.com/story.php?id=34&story_fbid=12");
  });
  it.each(["javascript:alert(1)", "http://facebook.com/post", "https://facebook.com.evil.test/a", "https://facebook.com@evil.test/a", "https://name:password@facebook.com/a", "https://facebook.com:444/a"])("rejects unsafe or external destinations: %s", value => {
    expect(() => normalizeFacebookReviewUrl(value)).toThrow();
  });
  it("keeps valid rows and reports rejected line numbers", () => {
    const result = addFacebookReviewLinks([], "https://www.facebook.com/posts/123\ninvalid\n\nhttps://www.facebook.com/ads/library/?id=456");
    expect(result.added).toBe(2);
    expect(result.rejected).toEqual([2]);
  });
  it("encodes keywords as search text, with stable saved URLs", () => {
    const item = facebookKeywordReviewItem("franquicias & supermercados");
    expect(new URL(item.url).searchParams.get("q")).toBe("franquicias & supermercados");
    expect(parseFacebookReviewQueue(JSON.stringify([item]))).toEqual([item]);
  });
  it("bounds queue size and validates stored destinations", () => {
    const links = Array.from({ length: 101 }, (_, i) => `https://www.facebook.com/posts/${i}`).join("\n");
    expect(addFacebookReviewLinks([], links).items).toHaveLength(100);
    expect(addFacebookReviewLinks([], links).rejected).toEqual([101]);
    expect(() => parseFacebookReviewQueue(JSON.stringify([{ url: "https://evil.test", label: "post", kind: "link", reviewed: false }]))).toThrow();
  });
});
