import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/leads/email-extract", () => ({ fetchText: vi.fn() }));
import { fetchText } from "@/lib/leads/email-extract";
import { coveredTopics, loadMonthlyReferences, normalizeTopics, repeatsUsedContent } from "../month-context";

describe("monthly editorial requirements", () => {
  it("deduplicates required topics without losing labels", () => {
    expect(normalizeTopics([" Bótox ", "bótox", "", "Rinoplastia"])).toEqual(["bótox", "Rinoplastia"]);
  });
  it("reports coverage only when actual copy contains the topic", () => {
    expect(coveredTopics({ title: "Tratamientos", content: "Conoce el botox y la rinoplastia" }, ["Bótox", "rinoplastia", "aumento de pecho"])).toEqual(["Bótox", "rinoplastia"]);
  });
  it("rejects reused titles and near-identical copy", () => {
    expect(repeatsUsedContent({ title: "¡El menú de hoy!" }, [{ title: "El menu de hoy", content: "otro" }])).toBe(true);
    const copy = "Descubre nuestros deliciosos platos frescos preparados diariamente usando ingredientes locales seleccionados cuidadosamente para ofrecer experiencias gastronómicas únicas";
    expect(repeatsUsedContent({ title: "Nuevo", content: copy + " siempre" }, [{ title: "Viejo", content: copy }])).toBe(true);
    expect(repeatsUsedContent({ title: "Rinoplastia: recuperación", content: "Recomendaciones para después de la intervención" }, [{ title: "Rinoplastia: consulta inicial", content: "Qué preguntar antes de la intervención" }])).toBe(false);
  });
  it("extracts menu facts from reference HTML", async () => {
    vi.mocked(fetchText).mockResolvedValue("<html><body><h1>Menú</h1><p>Arroz con bogavante, ensalada de tomate y lubina al horno todos los días.</p></body></html>");
    const refs = await loadMonthlyReferences(["https://example.com/menu", "https://example.com/menu"]);
    expect(refs).toHaveLength(1);
    expect(refs[0].text).toContain("Arroz con bogavante");
    expect(refs[0].text).not.toContain("<p>");
  });
  it("fails visibly when a mandatory reference cannot be read", async () => {
    vi.mocked(fetchText).mockRejectedValue(new Error("private_host"));
    await expect(loadMonthlyReferences(["http://127.0.0.1/menu"])).rejects.toThrow("No se pudo leer la referencia");
    vi.mocked(fetchText).mockResolvedValue("");
    await expect(loadMonthlyReferences(["https://example.com/empty"])).rejects.toThrow("no contiene texto utilizable");
  });
});
