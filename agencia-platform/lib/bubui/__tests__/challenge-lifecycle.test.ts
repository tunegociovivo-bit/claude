import { describe, expect, it } from "vitest";
import {
  challengeDaysLeft,
  challengeSavings,
  nextChallengeFollowup,
  normalizeChallengeService,
  buildChallengeTimeline,
  challengeConversionMetrics,
  scheduleChallengeFollowup,
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

describe("challenge timeline and metrics", () => {
  it("creates an auditable alta-contacto-resultado timeline", () => {
    expect(buildChallengeTimeline({
      registeredAt: new Date("2026-08-21T10:00:00Z"),
      contactedAt: new Date("2026-08-21T10:05:00Z"),
      decidedAt: new Date("2026-08-22T11:00:00Z"),
      status: "confirmed",
      contactChannel: "whatsapp",
    })).toEqual([
      { key: "registered", label: "Alta", at: "2026-08-21T10:00:00.000Z", state: "complete" },
      { key: "contacted", label: "Contacto por WhatsApp", at: "2026-08-21T10:05:00.000Z", state: "complete" },
      { key: "result", label: "Contratado", at: "2026-08-22T11:00:00.000Z", state: "complete" },
    ]);
  });

  it("keeps pending and discarded states explicit", () => {
    const pending = buildChallengeTimeline({ registeredAt: new Date("2026-08-21T10:00:00Z"), contactedAt: null, decidedAt: null, status: "registered", contactChannel: null });
    expect(pending[1].state).toBe("pending");
    expect(pending[2].label).toBe("Pendiente de resultado");
    const discarded = buildChallengeTimeline({ registeredAt: new Date("2026-08-21T10:00:00Z"), contactedAt: null, decidedAt: new Date("2026-08-22"), status: "declined", contactChannel: null });
    expect(discarded[2].label).toBe("Descartado");
  });

  it("calculates conversion by exact challenge and service mode", () => {
    expect(challengeConversionMetrics([
      { mode: "local", registered: true, contacted: true, confirmed: true, declined: false },
      { mode: "local", registered: true, contacted: true, confirmed: false, declined: true },
      { mode: "online", registered: true, contacted: false, confirmed: false, declined: false },
    ])).toEqual({
      total: { registered: 3, contacted: 2, confirmed: 1, declined: 1, contactRate: 67, conversionRate: 33 },
      local: { registered: 2, contacted: 2, confirmed: 1, declined: 1, contactRate: 100, conversionRate: 50 },
      online: { registered: 1, contacted: 0, confirmed: 0, declined: 0, contactRate: 0, conversionRate: 0 },
    });
  });

  it("uses the entrepreneur-configured first and repeated follow-up delays", () => {
    const from = new Date("2026-08-21T10:00:00Z");
    expect(scheduleChallengeFollowup("first", from, { firstHours: 12, repeatDays: 5 })).toEqual(new Date("2026-08-21T22:00:00Z"));
    expect(scheduleChallengeFollowup("repeat", from, { firstHours: 12, repeatDays: 5 })).toEqual(new Date("2026-08-26T10:00:00Z"));
  });
});
