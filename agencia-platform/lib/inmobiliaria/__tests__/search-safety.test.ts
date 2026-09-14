import { describe, expect, it } from "vitest";
import { cleanOfferUrl } from "@/lib/inmobiliaria/search";

describe("cleanOfferUrl", () => {
  const domains = ["idealista.com", "fotocasa.es"];

  it("keeps an individual listing on an allowed portal", () => {
    expect(cleanOfferUrl("https://www.idealista.com/inmueble/12345/", domains)).toContain("/inmueble/12345/");
  });

  it("rejects hosts outside the configured portals", () => {
    expect(cleanOfferUrl("https://idealista.com.evil.example/inmueble/123", domains)).toBe("");
    expect(cleanOfferUrl("http://127.0.0.1/admin", domains)).toBe("");
  });

  it("rejects generic listings and unsafe protocols", () => {
    expect(cleanOfferUrl("https://idealista.com/alquiler", domains)).toBe("");
    expect(cleanOfferUrl("javascript:alert(1)", domains)).toBe("");
  });
});
