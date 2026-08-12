import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDailyCost,
  composeAgentPrompt,
  normalizeGlobalPrompt,
  normalizeAdminNotes,
  normalizeClientName,
  normalizeClientEmail,
  createWorkspaceSlug,
  validateInitialPassword,
  calculateUsageOverview,
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

test("separa el consumo histórico del consumo de hoy", () => {
  const since = new Date("2026-08-12T00:00:00Z");
  const result = calculateUsageOverview({
    calls: [
      { createdAt: new Date("2026-08-11T10:00:00Z"), durationSec: 120, providerCost: 0.3 },
      { createdAt: new Date("2026-08-12T08:00:00Z"), durationSec: 60, providerCost: null },
    ],
    inboundMessages: [
      { createdAt: new Date("2026-08-11T10:00:00Z") },
      { createdAt: new Date("2026-08-12T09:00:00Z") },
    ],
    since,
    callMinuteRate: 0.15,
    whatsappMessageRate: 0.005,
  });
  assert.equal(result.callsTotal, 2);
  assert.equal(result.callsToday, 1);
  assert.equal(result.whatsappTotal, 2);
  assert.equal(result.whatsappToday, 1);
  assert.equal(result.minutesTotal, 3);
  assert.equal(result.minutesToday, 1);
  assert.equal(result.totalCost, 0.455);
  assert.equal(result.totalCostToday, 0.155);
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

test("exige un nombre de cliente válido y lo limita", () => {
  assert.equal(normalizeClientName("  Clínica Centro  "), "Clínica Centro");
  assert.equal(normalizeClientName("x".repeat(300)).length, 120);
  assert.equal(normalizeClientName("   "), "");
});

test("prepara los datos necesarios para crear un CRM de cliente", () => {
  assert.equal(normalizeClientEmail("  CLIENTE@EMPRESA.COM "), "cliente@empresa.com");
  assert.equal(normalizeClientEmail("correo-invalido"), "");
  assert.equal(createWorkspaceSlug("Clinica Malaga & Salud"), "clinica-malaga-salud");
  assert.equal(createWorkspaceSlug("---"), "cliente");
  assert.equal(validateInitialPassword("segura123"), true);
  assert.equal(validateInitialPassword("corta"), false);
});
