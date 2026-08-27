import { describe, expect, it } from "vitest";
import { alignDueDateToExplicitWeekday } from "../scheduled-followups";

describe("alignDueDateToExplicitWeekday", () => {
  it("corrige viernes 29 de agosto de 2026 al viernes 28", () => {
    const wrong = new Date("2026-08-29T07:00:00.000Z");
    expect(alignDueDateToExplicitWeekday(wrong, "Enviar el viernes a las 9:00").toISOString()).toBe("2026-08-28T07:00:00.000Z");
  });

  it("no modifica la fecha si aparecen varios días en el contexto", () => {
    const original = new Date("2026-08-29T07:00:00.000Z");
    expect(alignDueDateToExplicitWeekday(original, "jueves y viernes")).toEqual(original);
  });
});
