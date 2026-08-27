import { describe, expect, it } from "vitest";
import { alignDueDateToExplicitSpainTime, alignDueDateToExplicitWeekday } from "../scheduled-followups";

describe("alignDueDateToExplicitWeekday", () => {
  it("corrige viernes 29 de agosto de 2026 al viernes 28", () => {
    const wrong = new Date("2026-08-29T07:00:00.000Z");
    expect(alignDueDateToExplicitWeekday(wrong, "Enviar el viernes a las 9:00").toISOString()).toBe("2026-08-28T07:00:00.000Z");
  });

  it("convierte 17:50 copiado como UTC a 17:50 hora peninsular de verano", () => {
    const wrong = new Date("2026-08-27T17:50:00.000Z");
    expect(alignDueDateToExplicitSpainTime(wrong, "Enviar hoy a las 17:50 hora España").toISOString()).toBe("2026-08-27T15:50:00.000Z");
  });

  it("no modifica la fecha si aparecen varios días en el contexto", () => {
    const original = new Date("2026-08-29T07:00:00.000Z");
    expect(alignDueDateToExplicitWeekday(original, "jueves y viernes")).toEqual(original);
  });
});
