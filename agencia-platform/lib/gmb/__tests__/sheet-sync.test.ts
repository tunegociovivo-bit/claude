import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/integrations/google-sheets", () => ({}));
vi.mock("@/lib/integrations/gmb", () => ({}));
import { cellDate, mapTabs, monthKeyFromCell } from "@/lib/gmb/sheet-sync";

describe("sheet-sync", () => {
  it("lee las fechas de la plantilla", () => {
    expect(monthKeyFromCell("1/07/2025")).toBe("2025-07");
    expect(monthKeyFromCell("1/1/2026")).toBe("2026-01");
    expect(monthKeyFromCell("2026-09-01")).toBe("2026-09");
    expect(monthKeyFromCell(46023)).toBe("2026-01");
    expect(monthKeyFromCell("Fecha")).toBeNull();
    expect(cellDate("2026-09")).toBe("1/09/2026");
  });
  it("localiza las pestañas", () => {
    expect(mapTabs(["Vistas perfil empresa", "Llamadas", "Cómo llegar", "Clicks sitio web", "Palabras Clave"])).toEqual({
      keywords: "Palabras Clave",
      views: "Vistas perfil empresa",
      calls: "Llamadas",
      directions: "Cómo llegar",
      website: "Clicks sitio web"
    });
  });
});
