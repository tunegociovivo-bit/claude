import test from "node:test";
import assert from "node:assert/strict";
import { applyWhatsappServer, whatsappServerStatus } from "../lib/admin/whatsapp-server";

test("estado: activado solo con dirección y API key; muestra solo el host", () => {
  assert.deepEqual(whatsappServerStatus({}), { configured: false, host: null });
  assert.deepEqual(whatsappServerStatus({ whatsapp: { wahaUrl: "http://116.203.16.76:3000", wahaApiKeyEnc: "" } }), { configured: false, host: "116.203.16.76:3000" });
  assert.deepEqual(whatsappServerStatus({ whatsapp: { wahaUrl: "http://116.203.16.76:3000", wahaApiKeyEnc: "enc" } }), { configured: true, host: "116.203.16.76:3000" });
  assert.deepEqual(whatsappServerStatus({ whatsapp: { wahaUrl: "no es url", wahaApiKeyEnc: "enc" } }), { configured: true, host: null });
});

test("alta nueva: la sesión principal es la propia del cliente, nunca «default»", () => {
  const s: Record<string, any> = { whatsapp: { wahaSession: "default", autoReplyEnabled: false }, modules: { leads: true } };
  applyWhatsappServer(s, { baseUrl: "http://w:3000", apiKeyEnc: "enc", ownSession: "paula-ws1", wasConfigured: false, webhookToken: "t".repeat(24) });
  assert.equal(s.whatsapp.wahaUrl, "http://w:3000");
  assert.equal(s.whatsapp.wahaApiKeyEnc, "enc");
  assert.equal(s.whatsapp.wahaSession, "paula-ws1");
  assert.equal(s.whatsapp.countryCode, "34");
  assert.equal(s.whatsapp.autoReplyEnabled, false);
  assert.equal(s.whatsappWebhookToken, "t".repeat(24));
  assert.deepEqual(s.modules, { leads: true });
});

test("cambiar de servidor no toca la sesión ni el token de webhook existentes", () => {
  const s: Record<string, any> = { whatsapp: { wahaUrl: "http://old:3000", wahaApiKeyEnc: "old", wahaSession: "default", countryCode: "52" }, whatsappWebhookToken: "x".repeat(32) };
  applyWhatsappServer(s, { baseUrl: "http://new:3000", apiKeyEnc: "new", ownSession: "paula-ws1", wasConfigured: true, webhookToken: "y".repeat(24) });
  assert.equal(s.whatsapp.wahaSession, "default");
  assert.equal(s.whatsapp.countryCode, "52");
  assert.equal(s.whatsapp.wahaUrl, "http://new:3000");
  assert.equal(s.whatsappWebhookToken, "x".repeat(32));
});
