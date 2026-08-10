import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSoniaSystemPrompt,
  selectAvailableSlots,
  whatsappFallbackReply,
} from "../lib/ai/sonia";
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
  assert.match(prompt, /cada cifra por separado/i);
  assert.match(prompt, /No eres una asistente de cultura general/i);
  assert.match(prompt, /URL exacta/i);
});

test("la disponibilidad devuelve tres opciones y permite paginar", () => {
  const slots = ["09:00", "09:30", "10:00", "10:30", "11:00"].map(
    (time) => `2026-08-11T${time}:00`
  );
  assert.deepEqual(selectAvailableSlots(slots), {
    suggested: slots.slice(0, 3),
    hasMore: true,
  });
  assert.deepEqual(selectAvailableSlots(slots, "10:00"), {
    suggested: slots.slice(3),
    hasMore: false,
  });
});

test("WhatsApp dispone de respuesta segura incluso si falla la IA", () => {
  assert.match(whatsappFallbackReply(settings, true), /Paula/);
  assert.match(whatsappFallbackReply(settings, false), /repetírmelo/i);
});
