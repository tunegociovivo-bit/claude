import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAlertEmail,
  normalizeAlertPhone,
  shouldSendUrgentAlert,
} from "../lib/urgent-alerts";

test("valida y normaliza los destinos de alertas urgentes", () => {
  assert.equal(normalizeAlertEmail("  ADMIN@EMPRESA.COM "), "admin@empresa.com");
  assert.equal(normalizeAlertEmail("correo-invalido"), "");
  assert.equal(normalizeAlertPhone("+34 611 222 333", "34"), "34611222333");
  assert.equal(normalizeAlertPhone("611222333", "34"), "34611222333");
});

test("evita alertas duplicadas pero permite recordatorios y cambios de error", () => {
  const now = new Date("2026-08-11T10:00:00Z");
  assert.equal(shouldSendUrgentAlert({ lastCode: null, lastSentAt: null, code: "WHATSAPP_FAILED", now }), true);
  assert.equal(shouldSendUrgentAlert({ lastCode: "WHATSAPP_FAILED", lastSentAt: new Date("2026-08-11T09:30:00Z"), code: "WHATSAPP_FAILED", now }), false);
  assert.equal(shouldSendUrgentAlert({ lastCode: "WHATSAPP_FAILED", lastSentAt: new Date("2026-08-10T09:00:00Z"), code: "WHATSAPP_FAILED", now }), true);
  assert.equal(shouldSendUrgentAlert({ lastCode: "WHATSAPP_FAILED", lastSentAt: new Date("2026-08-11T09:59:00Z"), code: "CRM_MESSAGE_ERROR", now }), true);
});
