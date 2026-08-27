import { describe, expect, it } from "vitest";
import { hasFutureExecutionIntent } from "../temporal-intent";

describe("hasFutureExecutionIntent", () => {
  const now = new Date("2026-08-27T14:32:00.000Z"); // 16:32 en Madrid

  it("detecta una ejecución prevista para más tarde hoy", () => {
    expect(hasFutureExecutionIntent("Quiero que hoy a las 16:40 me lo generes", now)).toBe(true);
    expect(hasFutureExecutionIntent(
      "Quiero que hoy a las 17:20 lo generes y lo mandes por WhatsApp a las 9:00; el viernes a las 9:00 repite",
      now
    )).toBe(true);
  });

  it("no aplaza una hora de hoy que ya ha pasado", () => {
    expect(hasFutureExecutionIntent("Hazlo hoy a las 09:00", now)).toBe(false);
  });

  it("detecta encargos de mañana y de un día de la semana", () => {
    expect(hasFutureExecutionIntent("Mañana a las 9:00 envíalo", now)).toBe(true);
    expect(hasFutureExecutionIntent("El viernes a las 9:00 envíalo", now)).toBe(true);
  });

  it("no confunde periodos de datos sin hora con una programación", () => {
    expect(hasFutureExecutionIntent("Genera los leads de los días 26 y 27 de agosto", now)).toBe(false);
  });
});
