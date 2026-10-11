import { describe, expect, it } from "vitest";
import { adsMatchingPostText, creativeBodyTexts } from "../comments";

const copyA = "¿Tienes un local comercial de más de 250 m²? Conviértelo en un supermercado EROSKI 🛒";
const copyB = "Emprende con EROSKI: abre tu propio supermercado franquiciado con nuestro apoyo";

describe("publicaciones de creatividad dinámica", () => {
  it("lee el texto principal y las variantes dinámicas del creative", () => {
    const texts = creativeBodyTexts({
      object_story_spec: { link_data: { message: copyA } },
      asset_feed_spec: { bodies: [{ text: copyB }, { text: "corto" }] }
    });
    expect(texts).toHaveLength(2);
  });

  it("asigna una publicación al anuncio cuyo texto coincide, ignorando emojis y signos", () => {
    const textsByAd = new Map([
      ["ad-locales", creativeBodyTexts({ asset_feed_spec: { bodies: [{ text: copyA }] } })],
      ["ad-emprende", creativeBodyTexts({ object_story_spec: { link_data: { message: copyB } } })]
    ]);
    expect(adsMatchingPostText("¿Tienes un local comercial de más de 250 m²? Conviértelo en un supermercado EROSKI", textsByAd)).toEqual(["ad-locales"]);
    expect(adsMatchingPostText(copyB, textsByAd)).toEqual(["ad-emprende"]);
  });

  it("no asigna publicaciones de otras campañas ni textos demasiado cortos", () => {
    const textsByAd = new Map([["ad-locales", creativeBodyTexts({ asset_feed_spec: { bodies: [{ text: copyA }] } })]]);
    expect(adsMatchingPostText("Oferta de verano en todas nuestras tiendas de la cadena", textsByAd)).toEqual([]);
    expect(adsMatchingPostText("Hola", textsByAd)).toEqual([]);
    expect(adsMatchingPostText("", textsByAd)).toEqual([]);
  });
});

import { dynamicCreativeWindows } from "../comments";

describe("franjas de búsqueda de variantes dinámicas", () => {
  it("une franjas solapadas de creación y edición", () => {
    const windows = dynamicCreativeWindows([
      { created_time: "2026-02-10T10:00:00+0000", updated_time: "2026-02-10T10:20:00+0000" },
      { created_time: "2026-02-10T12:00:00+0000" },
      { created_time: "2026-05-01T09:00:00+0000", updated_time: "2026-06-01T09:00:00+0000" }
    ]);
    expect(windows).toHaveLength(3);
    expect(new Date(windows[0].from).toISOString()).toBe("2026-02-10T09:00:00.000Z");
    expect(new Date(windows[0].to).toISOString()).toBe("2026-02-10T18:00:00.000Z");
    expect(new Date(windows[2].from).toISOString()).toBe("2026-06-01T08:00:00.000Z");
  });

  it("ignora fechas ausentes o inválidas", () => {
    expect(dynamicCreativeWindows([{}, { created_time: "x" }])).toEqual([]);
  });
});
