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
