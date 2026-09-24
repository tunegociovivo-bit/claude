import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITORIAL_IMAGE_PRESETS, editorialStorageKey, parseMediaUrls, prependMediaUrl } from "../media";

describe("editorial media helpers", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("only resolves own tenant media on exact storage origins", () => {
    vi.stubEnv("STORAGE_ENDPOINT", "https://storage.example.com");
    vi.stubEnv("STORAGE_BUCKET", "assets");
    vi.stubEnv("STORAGE_PUBLIC_URL", "https://cdn.example.com/media");
    expect(editorialStorageKey("https://storage.example.com/assets/w1/editorial/p/a.png?expired=yes", "w1")).toBe("w1/editorial/p/a.png");
    expect(editorialStorageKey("https://assets.storage.example.com/w1/editorial/p/a.png", "w1")).toBe("w1/editorial/p/a.png");
    expect(editorialStorageKey("https://cdn.example.com/media/w1/a.png", "w1")).toBe("w1/a.png");
    expect(editorialStorageKey("https://storage.example.com.evil.test/assets/w1/a.png", "w1")).toBeNull();
    expect(editorialStorageKey("http://127.0.0.1/w1/a.png", "w1")).toBeNull();
    expect(editorialStorageKey("https://storage.example.com/assets/w2/a.png", "w1")).toBeNull();
  });
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

  it("does not duplicate a version when its download signature changes", () => {
    const original = "https://storage.example/original.png?signature=old";
    const fresh = "https://storage.example/original.png?signature=new";
    expect(JSON.parse(prependMediaUrl(JSON.stringify([original]), fresh))).toEqual([fresh]);
  });

  it("keeps social image presets explicit", () => {
    expect(EDITORIAL_IMAGE_PRESETS.instagram_portrait).toEqual({ width: 1080, height: 1350 });
    expect(EDITORIAL_IMAGE_PRESETS.reel_story).toEqual({ width: 1080, height: 1920 });
  });
});
