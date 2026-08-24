import { describe, expect, it } from "vitest";
import { resolveInstagramMediaTarget, shouldHydrateMetaCreative } from "../comments";

describe("Instagram comment target discovery", () => {
  it("rehidrata la creatividad aunque Facebook ya haya devuelto su publicación", () => {
    expect(shouldHydrateMetaCreative({ id: "creative-1", effective_object_story_id: "page_post" })).toBe(true);
  });

  it("resuelve una publicación de Instagram desde su permalink cuando Meta omite el story id", () => {
    const mediaByPermalink = new Map([
      ["https://www.instagram.com/p/ABC123", { id: "ig-media-1", ownerId: "ig-account-1", token: "page-token" }]
    ]);
    expect(resolveInstagramMediaTarget({ instagram_permalink_url: "https://www.instagram.com/p/ABC123/?utm_source=ig" }, mediaByPermalink)).toEqual({
      id: "ig-media-1",
      ownerId: "ig-account-1",
      platform: "instagram",
      token: "page-token"
    });
  });

  it("prioriza el identificador directo de Instagram cuando está disponible", () => {
    expect(resolveInstagramMediaTarget({ effective_instagram_story_id: "ig-direct", instagram_actor_id: "ig-account-1" }, new Map())).toMatchObject({
      id: "ig-direct",
      ownerId: "ig-account-1",
      platform: "instagram"
    });
  });
});
