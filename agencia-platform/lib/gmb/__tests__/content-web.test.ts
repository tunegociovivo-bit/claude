import { describe, it, expect } from "vitest";
import { contentIdeas, cadenceHealth } from "../content";
import { webRecommendations, buildLocalBusinessSchema } from "../web-local";

describe("content drafts", () => {
  it("genera borradores de novedad/oferta/evento por categoría", () => {
    const ideas = contentIdeas({ category: "cafetería", name: "Café Demo", keyword: "cafetería málaga" });
    expect(ideas.length).toBeGreaterThanOrEqual(3);
    expect(ideas.some((i) => i.type === "offer")).toBe(true);
    expect(ideas.some((i) => i.type === "event")).toBe(true);
    expect(ideas[0].cta).toBeTruthy();
  });
  it("cadencia: 0 posts → none; <4 → low; >=4 → good", () => {
    expect(cadenceHealth(0).status).toBe("none");
    expect(cadenceHealth(2).status).toBe("low");
    expect(cadenceHealth(4).status).toBe("good");
  });
});

describe("web-local recommendations", () => {
  it("sin web recomienda crear landing con impacto alto", () => {
    const recs = webRecommendations({ category: "dentista", city: "Estepona", hasWebsite: false });
    expect(recs[0].impact).toBeGreaterThanOrEqual(60);
    expect(recs.some((r) => r.type === "schema")).toBe(true);
  });
  it("schema LocalBusiness JSON-LD desde NAP, sin campos undefined", () => {
    const schema = buildLocalBusinessSchema({ nap: { name: "Sergisa SL", address: "C/ Calvario 32", phone: "952796658", website: "sergisa.es" }, city: "Estepona", lat: 36.4, lng: -5.1 });
    expect(schema["@type"]).toBe("LocalBusiness");
    expect(schema.name).toBe("Sergisa SL");
    expect(schema.geo.latitude).toBe(36.4);
    expect(JSON.stringify(schema)).not.toContain("undefined");
  });
});
