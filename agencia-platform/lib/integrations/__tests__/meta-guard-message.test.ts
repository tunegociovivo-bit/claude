import { describe, expect, it } from "vitest";
import { buildMetaGuardAnnouncement } from "../meta-guard-message";

describe("buildMetaGuardAnnouncement", () => {
  it("explains that only Hub API writes are paused, not campaign delivery", () => {
    const text = buildMetaGuardAnnouncement({ minutes: 10, reason: "uso 97%", firstName: "David" });

    expect(text).toContain("API de Meta");
    expect(text).toContain("uso de cuota 97%");
    expect(text).toContain("campañas activas continúan publicándose");
    expect(text).toContain("10 minutos");
    expect(text).not.toContain("No publiques nada en Meta");
  });
});
