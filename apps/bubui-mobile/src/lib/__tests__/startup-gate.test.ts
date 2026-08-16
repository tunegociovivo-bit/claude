import { describe, expect, it } from "vitest";
import { fontsReadyForUi } from "../startup-gate";

describe("fontsReadyForUi", () => {
  it("abre la app al vencer el margen aunque Ionicons siga pendiente", () => {
    expect(fontsReadyForUi({ loaded: false, error: null, timedOut: true })).toBe(true);
  });

  it("renderiza cuando todas las fuentes, incluida Ionicons, están registradas", () => {
    expect(fontsReadyForUi({ loaded: true, error: null, timedOut: false })).toBe(true);
  });

  it("abre la app con fuentes de sistema si Ionicons falla", () => {
    expect(fontsReadyForUi({ loaded: false, error: new Error("font failed"), timedOut: false })).toBe(true);
  });

  it("mantiene el splash mientras la fuente está dentro del margen", () => {
    expect(fontsReadyForUi({ loaded: false, error: null, timedOut: false })).toBe(false);
  });
});
