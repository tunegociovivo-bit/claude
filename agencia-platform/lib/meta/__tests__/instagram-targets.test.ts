import { describe, expect, it } from "vitest";
import { fallbackInstagramMediaTargets, matchInstagramMediaForCreative, resolveInstagramMediaTarget, shouldHydrateMetaCreative } from "../comments";

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

  it("identifica el medio por el texto del anuncio cuando Meta oculta ids y permalink", () => {
    const creative = { object_story_spec: { video_data: { message: "20 años formando artistas, ¡y ahora tú puedes ser el siguiente!" } } };
    const media = [
      { id: "unrelated", caption: "Otro anuncio distinto" },
      { id: "esaem-media", caption: "20 años formando artistas, ¡y ahora tú puedes ser el siguiente! 🎭 Bachillerato de Artes Escénicas" }
    ];
    expect(matchInstagramMediaForCreative(creative, media)).toEqual(media[1]);
  });

  it("identifica medios de creatividades dinámicas mediante asset_feed_spec", () => {
    const creative = { asset_feed_spec: { bodies: [{ text: "20 años formando artistas, ¡y ahora tú puedes ser el siguiente!" }] } };
    const media = [{ id: "esaem-dynamic", caption: "20 años formando artistas, ¡y ahora tú puedes ser el siguiente! 🎭" }];
    expect(matchInstagramMediaForCreative(creative, media)).toEqual(media[0]);
  });

  it("usa todos los medios de la cuenta como respaldo sin duplicarlos", () => {
    const media = [{ id: "m1", ownerId: "ig-1", token: "token" }, { id: "m1", ownerId: "ig-1", token: "token" }, { id: "m2", ownerId: "ig-1", token: "token" }];
    expect(fallbackInstagramMediaTargets(media).map((item) => item.id)).toEqual(["m1", "m2"]);
  });
});
