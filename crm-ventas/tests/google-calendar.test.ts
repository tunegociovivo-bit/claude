import test from "node:test";
import assert from "node:assert/strict";
import { buildGoogleEvent, googleCalendarConfigured } from "../lib/google-calendar";

test("convierte una cita del CRM en un evento de Google Calendar", () => {
  const event = buildGoogleEvent({
    customerName: "Ana Pérez",
    customerPhone: "600123123",
    startsAt: new Date("2026-08-12T10:00:00.000Z"),
    durationMin: 90,
    notes: "Masaje tailandés",
    status: "confirmada",
  });
  assert.equal(event.summary, "Cita · Ana Pérez");
  assert.equal(event.end.dateTime, "2026-08-12T11:30:00.000Z");
  assert.match(event.description, /600123123/);
});

test("detecta si faltan credenciales OAuth sin exponerlas", () => {
  assert.equal(googleCalendarConfigured({ clientId: "", clientSecret: "" }), false);
  assert.equal(googleCalendarConfigured({ clientId: "id", clientSecret: "secret" }), true);
});
