import { describe, expect, it } from "vitest";
import { classifyFranchiseNews } from "../franchise-signal-radar";

describe("franchise signal radar", () => {
  it("convierte titulares verificables en señales sin inventar fuentes", () => {
    const signals = classifyFranchiseNews([
      { title: "Marca abre ocho nuevos establecimientos en España", link: "https://example.com/apertura", publishedAt: "2026-08-20" },
      { title: "Marca busca una nueva directora de marketing", link: "https://example.com/empleo", publishedAt: "2026-08-21" },
      { title: "Artículo genérico sin intención comercial", link: "https://example.com/otro" }
    ]);
    expect(signals.map((signal) => signal.type)).toEqual(["new_locations", "marketing_hiring"]);
    expect(signals[0].sourceUrl).toBe("https://example.com/apertura");
  });
});
