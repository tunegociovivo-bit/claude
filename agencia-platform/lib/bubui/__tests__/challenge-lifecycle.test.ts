import { describe, expect, it } from "vitest";
import {
  challengeDaysLeft,
  challengeSavings,
  nextChallengeFollowup,
  normalizeChallengeService,
} from "../challenge-lifecycle";

describe("challenge lifecycle", () => {
  it("muestra la caducidad siempre en dias", () => {
    const now = new Date("2026-08-21T10:00:00Z");
    expect(challengeDaysLeft(new Date("2026-08-21T12:00:00Z"), now)).toBe(1);
    expect(challengeDaysLeft(new Date("2026-08-23T09:00:00Z"), now)).toBe(2);
  });

  it("calcula precio final y ahorro sin errores de redondeo visibles", () => {
    expect(challengeSavings(80, 15)).toEqual({ price: 80, savings: 12, finalPrice: 68 });
    expect(challengeSavings(null, 15)).toBeNull();
  });

  it("exige descripcion y datos de contacto coherentes con el modo", () => {
    expect(normalizeChallengeService({ mode: "local", description: "  Entrenamiento personal ", price: 80 }))
      .toEqual({ mode: "local", description: "Entrenamiento personal", price: 80 });
    expect(() => normalizeChallengeService({ mode: "online", description: "", price: 80 })).toThrow();
  });

  it("programa 24 horas y despues 3 dias; una tercera espera se marca perdida", () => {
    const registered = new Date("2026-08-21T10:00:00Z");
    expect(nextChallengeFollowup("registered", registered)).toEqual({ status: "awaiting_business", at: new Date("2026-08-22T10:00:00Z") });
    expect(nextChallengeFollowup("still_pending", registered)).toEqual({ status: "followup_pending", at: new Date("2026-08-24T10:00:00Z") });
    expect(nextChallengeFollowup("followup_pending", registered)).toEqual({ status: "lost", at: null });
  });
});
