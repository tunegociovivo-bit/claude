import { describe, expect, it } from "vitest";
import { fontsReadyForUi } from "../startup-gate";

describe("fontsReadyForUi", () => {
  it("no renderiza el menú sin Ionicons aunque haya vencido el margen de arranque", () => {
    expect(fontsReadyForUi({ loaded: false, error: null, timedOut: true })).toBe(false);
  });

  it("renderiza cuando todas las fuentes, incluida Ionicons, están registradas", () => {
    expect(fontsReadyForUi({ loaded: true, error: null, timedOut: false })).toBe(true);
  });

  it("un error de fuentes no se disfraza como estado listo", () => {
    expect(fontsReadyForUi({ loaded: false, error: new Error("font failed"), timedOut: false })).toBe(false);
  });
});
