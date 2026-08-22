import { afterEach, describe, expect, it } from "vitest";
import { publicMediaUrl, verifyPublicMedia } from "../public-media";

describe("public media durable URLs", () => {
  const previous = process.env.AUTH_SECRET;
  afterEach(() => { process.env.AUTH_SECRET = previous; });

  it("signs and verifies only public Bubui banner keys", () => {
    process.env.AUTH_SECRET = "test-secret";
    const url = new URL(publicMediaUrl("https://bubui.app", "bubui/ai-banner/biz/1.png"));
    const token = url.pathname.split("/").pop()!;
    expect(verifyPublicMedia(token, url.searchParams.get("sig")!)).toBe("bubui/ai-banner/biz/1.png");
    expect(verifyPublicMedia(token, "bad")).toBeNull();
    expect(() => publicMediaUrl("https://bubui.app", "private/secret.txt")).toThrow();
  });
});
