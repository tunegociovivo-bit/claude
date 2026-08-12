/**
 * Slice D — plan de pausa PURO: frase de confirmación (workspace+conteo),
 * elegibilidad, CSV de inventario anti-inyección.
 */
import { describe, it, expect } from "vitest";
import { expectedPhrase, phraseMatches, buildPausePlan, inventoryCsv, isPausable, isResumable } from "../pause-plan";

describe("expectedPhrase / phraseMatches", () => {
  it("liga verbo + conteo + token de workspace", () => {
    expect(expectedPhrase("pause", 12, "ws_ABC12345xyz")).toBe("PAUSAR 12 PLANTILLAS EN wsabc123");
    expect(expectedPhrase("resume", 3, "ws_ABC12345xyz")).toBe("REANUDAR 3 PLANTILLAS EN wsabc123");
  });
  it("match estricto (colapsa espacios; distinto conteo/workspace no cuela)", () => {
    const p = expectedPhrase("pause", 12, "w1");
    expect(phraseMatches("  PAUSAR 12 PLANTILLAS EN w1 ", p)).toBe(true);
    expect(phraseMatches("PAUSAR 11 PLANTILLAS EN w1", p)).toBe(false);
    expect(phraseMatches("pausar 12 plantillas en w1", p)).toBe(false); // case-sensitive verbo
  });
});

describe("buildPausePlan — elegibilidad", () => {
  const rows = [
    { id: "a", status: "active" },
    { id: "b", status: "draft" },
    { id: "c", status: "paused" }, // ya pausada
    { id: "d", status: "archived" } // no pausable
  ];
  it("pausar: elegibles active/draft; salta paused/archived/no-encontrada", () => {
    const plan = buildPausePlan("pause", ["a", "b", "c", "d", "z"], rows, "w1");
    expect(plan.eligibleIds.sort()).toEqual(["a", "b"]);
    expect(plan.count).toBe(2);
    expect(plan.phrase).toBe(expectedPhrase("pause", 2, "w1"));
    expect(plan.skipped.find((s) => s.id === "z")?.reason).toMatch(/no encontrada/);
    expect(plan.skipped.find((s) => s.id === "c")?.reason).toMatch(/ya está paused/);
  });
  it("reanudar: solo paused es elegible", () => {
    const plan = buildPausePlan("resume", ["a", "c"], rows, "w1");
    expect(plan.eligibleIds).toEqual(["c"]);
  });
  it("helpers de estado", () => {
    expect(isPausable("active")).toBe(true);
    expect(isPausable("paused")).toBe(false);
    expect(isResumable("paused")).toBe(true);
  });
});

describe("inventoryCsv — anti formula-injection", () => {
  it("neutraliza celdas peligrosas y escapa comas/comillas", () => {
    const csv = inventoryCsv([{ clientName: "=CMD()", totalCents: 12100, currency: "EUR", intervalMonths: 1, series: "FAC,X", pausedInHolded: false }]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("cliente,importe_eur,moneda,periodicidad_meses,serie,pausada_en_holded");
    expect(lines[1]).toContain("'=CMD()"); // sanitizado
    expect(lines[1]).toContain('"FAC,X"'); // coma escapada
    expect(lines[1]).toContain("121.00");
  });
});
