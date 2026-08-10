/**
 * Tests del rango de día LOCAL exacto (filtro por fecha del inbox). Sin depender
 * del huso de la máquina de test: se comprueban invariantes (medianoche local,
 * 24 h en un día sin cambio de hora, y que un instante del día cae dentro).
 */
import { describe, it, expect } from "vitest";
import { localDayRangeUtc } from "../local-day";

describe("localDayRangeUtc", () => {
  it("devuelve null para formatos inválidos", () => {
    for (const bad of ["", "2026-13-01", "2026-02-31", "15/06/2026", "2026-6-1", "abc", "2026-00-10"]) {
      expect(localDayRangeUtc(bad)).toBeNull();
    }
  });

  it("from es la medianoche LOCAL del día pedido", () => {
    const r = localDayRangeUtc("2026-06-15")!;
    expect(r).not.toBeNull();
    const from = new Date(r.from);
    expect(from.getFullYear()).toBe(2026);
    expect(from.getMonth()).toBe(5); // junio (0-index)
    expect(from.getDate()).toBe(15);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(from.getSeconds()).toBe(0);
  });

  it("el rango cubre exactamente 24 h en un día sin cambio de hora", () => {
    const r = localDayRangeUtc("2026-06-15")!;
    const ms = new Date(r.to).getTime() - new Date(r.from).getTime();
    expect(ms).toBe(24 * 60 * 60 * 1000);
  });

  it("un instante del mediodía local de ese día cae dentro de [from, to)", () => {
    const r = localDayRangeUtc("2026-06-15")!;
    const localNoon = new Date(2026, 5, 15, 12, 0, 0, 0).getTime();
    expect(localNoon).toBeGreaterThanOrEqual(new Date(r.from).getTime());
    expect(localNoon).toBeLessThan(new Date(r.to).getTime());
    // El día anterior y el siguiente quedan FUERA.
    const prevNoon = new Date(2026, 5, 14, 12, 0, 0, 0).getTime();
    const nextNoon = new Date(2026, 5, 16, 12, 0, 0, 0).getTime();
    expect(prevNoon).toBeLessThan(new Date(r.from).getTime());
    expect(nextNoon).toBeGreaterThanOrEqual(new Date(r.to).getTime());
  });

  it("cruza fin de mes correctamente", () => {
    const r = localDayRangeUtc("2026-01-31")!;
    const to = new Date(r.to);
    expect(to.getMonth()).toBe(1); // febrero
    expect(to.getDate()).toBe(1);
  });
});
