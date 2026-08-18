import { describe, it, expect } from "vitest";
import { buildConnections, buildOnboardingChecklist, connectionsSummary } from "../connections";
import { parseCitationsCsv, buildCitationsCsv } from "../citations/csv";

describe("connections — nunca expone claves, estado honesto", () => {
  const flags = { gbp: false, maps: true, make: true, anthropic: true, openai: false, gemini: false, perplexity: false };
  it("lista de conexiones con estado y alcance, sin claves", () => {
    const conns = buildConnections(flags);
    expect(conns.find((c) => c.id === "maps")?.connected).toBe(true);
    expect(conns.find((c) => c.id === "gbp")?.connected).toBe(false);
    // Ninguna entrada contiene una clave; solo nombres de env var.
    for (const c of conns) expect(JSON.stringify(c)).not.toMatch(/sk-|AIza|key=/i);
  });
  it("checklist marca lo hecho", () => {
    const cl = buildOnboardingChecklist(flags);
    expect(cl.find((i) => i.label.includes("Maps"))?.done).toBe(true);
    expect(cl.find((i) => i.label.includes("Business Profile"))?.done).toBe(false);
    expect(cl.find((i) => i.label.includes("modelo de IA"))?.done).toBe(true); // anthropic
  });
  it("resumen conectados/total", () => {
    expect(connectionsSummary(flags)).toEqual({ connected: 3, total: 7 });
  });
});

describe("citations CSV — importar sin inventar, exportar", () => {
  it("parse tolerante con comillas y status por defecto", () => {
    const csv = `directory,url,status,name,phone\nGoogle Business Profile,https://x,published,"Café, S.L.",952796658\nYelp España,,inexistente,Café,`;
    const { rows, errors } = parseCitationsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Café, S.L.");
    expect(rows[1].status).toBe("not_found"); // status inválido → not_found (no inventa presencia)
  });
  it("falta columna directory → error", () => {
    expect(parseCitationsCsv("url,status\nx,published").errors[0]).toMatch(/directory/);
  });
  it("export produce CSV con cabecera", () => {
    const out = buildCitationsCsv([{ directorySlug: "yelp-es", directoryName: "Yelp", url: "u", status: "published", napObserved: { phone: "9" } }]);
    expect(out.split("\n")[0]).toBe("directory,url,status,name,address,phone,website");
    expect(out).toContain("yelp-es");
  });
});
