import { describe, expect, it } from "vitest";
import { cleanOfferUrl } from "@/lib/inmobiliaria/search";

describe("cleanOfferUrl", () => {
  const domains = ["idealista.com", "fotocasa.es", "milanuncios.com", "habitaclia.com"];

  it("keeps an individual listing on an allowed portal", () => {
    expect(cleanOfferUrl("https://www.idealista.com/inmueble/12345/", domains)).toContain("/inmueble/12345/");
  });

  it("rejects hosts outside the configured portals", () => {
    expect(cleanOfferUrl("https://idealista.com.evil.example/inmueble/123", domains)).toBe("");
    expect(cleanOfferUrl("http://127.0.0.1/admin", domains)).toBe("");
  });

  it("rejects generic listings and unsafe protocols", () => {
    expect(cleanOfferUrl("https://idealista.com/alquiler", domains)).toBe("");
    expect(cleanOfferUrl("https://www.milanuncios.com/alquiler-de-locales-comerciales-en-malaga/sin-traspaso.htm", domains)).toBe("");
    expect(cleanOfferUrl("https://www.milanuncios.com/alquiler-de-locales-comerciales-en-malaga/taller.htm", domains)).toBe("");
    expect(cleanOfferUrl("https://www.milanuncios.com/alquiler-de-locales-comerciales-en-teatinos-malaga-malaga/", domains)).toBe("");
    expect(cleanOfferUrl("javascript:alert(1)", domains)).toBe("");
  });

  it("keeps Milanuncios and Habitaclia detail pages only when they include listing ids", () => {
    expect(cleanOfferUrl("https://www.milanuncios.com/alquiler-de-locales-comerciales-en-malaga/local-comercial-en-centro-123456789.htm", domains)).toContain("123456789.htm");
    expect(cleanOfferUrl("https://www.habitaclia.com/alquiler-local_comercial-malaga-i123456789.htm", domains)).toContain("i123456789.htm");
  });
});
