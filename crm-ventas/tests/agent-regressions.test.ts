import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSoniaSystemPrompt,
  selectAvailableSlots,
  whatsappFallbackReply,
  businessClock,
  effectiveOpeningHours,
  voiceFirstMessage,
} from "../lib/ai/sonia";
import {
  APPOINTMENT_TRANSACTION_OPTIONS,
  parseAppointmentDateTime,
  zonedDateTime,
} from "../lib/appointments";
import type { WorkspaceSettings } from "../lib/settings";

const settings = {
  sonia: {
    agentName: "Paula",
    businessName: "Negocio Vivo",
    businessInfo: "Promoción de verano: https://example.com/promociones",
    openingHours: "Lunes a viernes, 9:00 a 18:00",
    promptExtra: "Atiende solo consultas del negocio.",
  },
  whatsapp: { countryCode: "34" },
} as WorkspaceSettings;

test("la voz usa horas naturales, teléfonos por cifras y se limita al negocio", () => {
  const prompt = buildSoniaSystemPrompt(settings, "llamada");
  assert.match(prompt, /nueve y media/);
  assert.match(prompt, /máximo de tres opciones/i);
  assert.match(prompt, /nueve cifras una por una/i);
  assert.match(prompt, /nunca digas «dieciséis»/i);
  assert.match(prompt, /No eres una asistente de cultura general/i);
  assert.match(prompt, /URL exacta/i);
});

test("la disponibilidad devuelve tres opciones y permite paginar", () => {
  const slots = ["09:00", "09:30", "10:00", "10:30", "11:00"].map(
    (time) => `2026-08-11T${time}:00`
  );
  const beforeOpening = new Date("2026-08-11T05:00:00Z");
  assert.deepEqual(selectAvailableSlots(slots, undefined, beforeOpening), {
    suggested: slots.slice(0, 3),
    hasMore: true,
  });
  assert.deepEqual(selectAvailableSlots(slots, "10:00", beforeOpening), {
    suggested: slots.slice(3),
    hasMore: false,
  });
});

test("WhatsApp dispone de respuesta segura incluso si falla la IA", () => {
  assert.match(whatsappFallbackReply(settings, true), /Paula/);
  assert.match(whatsappFallbackReply(settings, false), /repetírmelo/i);
});

test("limpia el saludo de voz y respeta la marca indicada por la web", () => {
  const configured = {
    ...settings,
    sonia: {
      ...settings.sonia,
      websiteUrl: "https://aruksathaimassage.com",
      firstMessage: "Hola, soy soy Paula, la asistente de Aruxa Thai Massage.",
    },
  } as WorkspaceSettings;
  assert.equal(
    voiceFirstMessage(configured),
    "Hola, soy Paula, la asistente de Aruksa Thai Massage."
  );
});

test("la fecha de voz incluye hoy y maÃ±ana sin depender de la zona del servidor", () => {
  const clock = businessClock(new Date("2026-08-11T07:30:00Z"));
  assert.equal(clock.todayISO, "2026-08-11");
  assert.equal(clock.tomorrowISO, "2026-08-12");
  const prompt = buildSoniaSystemPrompt(settings, "llamada", "", new Date("2026-08-11T07:30:00Z"));
  assert.match(prompt, /2026-08-11/);
  assert.match(prompt, /2026-08-12/);
  assert.match(prompt, /Nunca ofrezcas una hora que ya haya pasado/i);
  assert.match(prompt, /Nunca inventes precios/i);
  assert.match(prompt, /conserva.*nombre.*teléfono/i);
});

test("usa el horario escrito en la informaciÃ³n del negocio", () => {
  const configured = {
    ...settings,
    sonia: {
      ...settings.sonia,
      openingHours: "Lunes a viernes de 9:00 a 18:00",
      businessInfo: "DirecciÃ³n: Madrid. Horario: Todos los dÃ­as de 11:30 a 22:00 INFORMACIÃ“N DE RESERVAS",
    },
  } as WorkspaceSettings;
  assert.equal(effectiveOpeningHours(configured), "Todos los dÃ­as de 11:30 a 22:00");
});

test("interpreta las fechas de herramientas como hora local de Madrid incluso si incluyen Z", () => {
  assert.equal(
    parseAppointmentDateTime("2026-08-12T10:00:00Z").getTime(),
    zonedDateTime("2026-08-12", 10, 0).getTime()
  );
});

test("no ofrece huecos de hoy que ya han pasado", () => {
  const slots = ["2026-08-11T09:00:00", "2026-08-11T10:00:00", "2026-08-11T11:00:00"];
  assert.deepEqual(selectAvailableSlots(slots, undefined, new Date("2026-08-11T08:30:00Z")), {
    suggested: ["2026-08-11T11:00:00"],
    hasMore: false,
  });
});

test("las reservas usan una transacción portable sin bloqueos de sesión", () => {
  assert.equal(APPOINTMENT_TRANSACTION_OPTIONS.isolationLevel, "Serializable");
  assert.equal(APPOINTMENT_TRANSACTION_OPTIONS.timeout, 10_000);
});
