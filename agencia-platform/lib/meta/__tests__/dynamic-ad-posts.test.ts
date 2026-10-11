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

import { creativeSignature, matchAdPostToAds, normalizedAdLink } from "../comments";

describe("asignación de publicaciones dinámicas sin texto", () => {
  const signatures = new Map([
    ["locales", creativeSignature({ asset_feed_spec: {
      bodies: [{ text: "¿Tienes un local de más de 250 m²? Conviértelo en un supermercado EROSKI" }],
      titles: [{ text: "Abre tu supermercado EROSKI" }],
      link_urls: [{ website_url: "https://franquicias.eroski.es/franquicias/?utm_source=meta" }]
    } })],
    ["mexico", creativeSignature({ asset_feed_spec: {
      bodies: [{ text: "Emprende en México con una franquicia de supermercados" }],
      titles: [{ text: "Franquicias en México" }],
      link_urls: [{ website_url: "https://franquicias.eroski.es/mexico/" }]
    } })]
  ]);

  it("normaliza enlaces envueltos por Facebook y sin parámetros", () => {
    expect(normalizedAdLink("https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.franquicias.eroski.es%2Ffranquicias%2F%3Futm%3Dx&h=1")).toBe("franquicias.eroski.es/franquicias");
    expect(normalizedAdLink("no es url")).toBeNull();
  });

  it("asigna por enlace + titular cuando la publicación no trae texto", () => {
    expect(matchAdPostToAds({ message: "", titles: ["abre tu supermercado eroski"], links: ["franquicias.eroski.es/franquicias"] }, signatures)).toEqual({ adIds: ["locales"], by: "link_headline" });
  });

  it("asigna por enlace concreto si no hay titular", () => {
    expect(matchAdPostToAds({ message: "", titles: [], links: ["franquicias.eroski.es/mexico"] }, signatures)).toEqual({ adIds: ["mexico"], by: "link" });
  });

  it("descarta publicaciones con texto propio de otra campaña aunque compartan enlace", () => {
    expect(matchAdPostToAds({ message: "Ofertas de la semana en todos nuestros supermercados de la cadena", titles: [], links: ["franquicias.eroski.es/franquicias"] }, signatures)).toBeNull();
  });

  it("descarta enlaces a la portada sin titular coincidente", () => {
    const home = new Map([["a", creativeSignature({ asset_feed_spec: { link_urls: [{ website_url: "https://eroski.es/" }] } })]]);
    expect(matchAdPostToAds({ message: "", titles: ["otro titular"], links: ["eroski.es"] }, home)).toBeNull();
  });
});

import { mergeAdSignatures } from "../comments";

describe("textos retocados y versiones anteriores del anuncio", () => {
  it("acepta un texto con una palabra cambiada", () => {
    const original = "Tienes un local comercial de mas de 250 metros en tu ciudad Conviertelo en un supermercado EROSKI con nuestro apoyo";
    const edited = "Tienes un local comercial de mas de 250 metros en tu pueblo Conviertelo en un supermercado EROSKI con nuestro apoyo";
    expect(adsMatchingPostText(edited, new Map([["ad", creativeBodyTexts({ asset_feed_spec: { bodies: [{ text: original }] } })]]))).toEqual(["ad"]);
  });

  it("une la huella del creative actual con las anteriores", () => {
    const merged = mergeAdSignatures(
      creativeSignature({ asset_feed_spec: { bodies: [{ text: "Texto actual del anuncio de franquicias EROSKI" }] } }),
      creativeSignature({ asset_feed_spec: { bodies: [{ text: "Texto anterior del anuncio de franquicias EROSKI" }] } })
    );
    expect(merged.bodies).toHaveLength(2);
  });
});
