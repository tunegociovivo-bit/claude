import { describe, expect, it } from "vitest";
import { fontsReadyForUi } from "../../../../apps/bubui-mobile/src/lib/startup-gate";

describe("arranque móvil y fuente Ionicons", () => {
  it("no considera lista la UI por el mero timeout", () => {
    expect(fontsReadyForUi({ loaded: false, error: null, timedOut: true })).toBe(false);
  });

  it("solo permite la UI cuando el registro de fuentes terminó", () => {
    expect(fontsReadyForUi({ loaded: true, error: null, timedOut: false })).toBe(true);
  });
});
