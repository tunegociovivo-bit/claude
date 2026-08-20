import { describe, expect, it } from "vitest";
import { calendarEventVisibility } from "../visibility";

describe("calendarEventVisibility", () => {
  it("solo permite eventos del usuario y sus importaciones antiguas de Google", () => {
    expect(calendarEventVisibility("aitor")).toEqual({
      OR: [
        { ownerUserId: "aitor" },
        { ownerUserId: null, googleOwnerUserId: "aitor" }
      ]
    });
  });

  it("falla cerrado sin un usuario autenticado", () => {
    expect(calendarEventVisibility(null)).toEqual({ id: "__no_authenticated_calendar_owner__" });
  });
});
