import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDailyCost,
  composeAgentPrompt,
  normalizeGlobalPrompt,
  normalizeAdminNotes,
} from "../lib/admin/usage";

test("calcula el coste diario usando coste real y estimaciones solo cuando faltan datos", () => {
  const result = calculateDailyCost({
    calls: [
      { durationSec: 120, providerCost: 0.42 },
      { durationSec: 60, providerCost: null },
    ],
    inboundWhatsappMessages: 4,
    callMinuteRate: 0.15,
    whatsappMessageRate: 0.005,
  });
  assert.equal(result.callCost, 0.57);
  assert.equal(result.whatsappCost, 0.02);
  assert.equal(result.totalCost, 0.59);
});

test("el prompt general se añade al prompt de cada cliente con prioridad explícita", () => {
  const prompt = composeAgentPrompt("Solo responde sobre el negocio.", "Reglas de la clínica.");
  assert.match(prompt, /INSTRUCCIONES GENERALES DE NEGOCIO VIVO/);
  assert.match(prompt, /Solo responde sobre el negocio/);
  assert.match(prompt, /Reglas de la clínica/);
});

test("normaliza el prompt general y limita su tamaño", () => {
  assert.equal(normalizeGlobalPrompt("  Norma común  "), "Norma común");
  assert.equal(normalizeGlobalPrompt("x".repeat(20_000)).length, 12_000);
});

test("normaliza las notas internas del cliente y limita su tamaño", () => {
  assert.equal(normalizeAdminNotes("  Cliente prioritario  "), "Cliente prioritario");
  assert.equal(normalizeAdminNotes("x".repeat(10_000)).length, 4_000);
});
