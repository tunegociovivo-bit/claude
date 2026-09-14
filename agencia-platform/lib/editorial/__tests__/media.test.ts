import { describe, expect, it } from "vitest";
import { EDITORIAL_IMAGE_PRESETS, parseMediaUrls, prependMediaUrl } from "../media";

describe("editorial media helpers", () => {
  it("parses media url arrays defensively", () => {
    expect(parseMediaUrls('["https://a.test/1.png",42,null,"https://a.test/2.mp4"]')).toEqual([
      "https://a.test/1.png",
      "https://a.test/2.mp4"
    ]);
    expect(parseMediaUrls("not-json")).toEqual([]);
  });

  it("prepends new media without duplicating the url", () => {
    expect(JSON.parse(prependMediaUrl('["old","new"]', "new"))).toEqual(["new", "old"]);
  });

  it("keeps social image presets explicit", () => {
    expect(EDITORIAL_IMAGE_PRESETS.instagram_portrait).toEqual({ width: 1080, height: 1350 });
    expect(EDITORIAL_IMAGE_PRESETS.reel_story).toEqual({ width: 1080, height: 1920 });
  });
});
