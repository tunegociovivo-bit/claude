import test from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY = "test-key-api";

test("resolveApiKey: propia del cliente > antigua del módulo > Negocio Vivo > ninguna", async () => {
  const { resolveApiKey, applyApiKeysPatch } = await import("../lib/api-keys");
  const { encryptSecret } = await import("../lib/ai/crypto");
  process.env.SERPER_API_KEY = "nv-serper-key-123";
  delete process.env.OPENAI_API_KEY;

  assert.deepEqual(resolveApiKey({}, "serper"), { key: "nv-serper-key-123", source: "negociovivo" });
  assert.deepEqual(resolveApiKey({}, "openai"), { key: null, source: "none" });

  const settings: Record<string, any> = {};
  applyApiKeysPatch(settings, { serper: "  client-serper-key-999  " });
  assert.deepEqual(resolveApiKey(settings, "serper"), { key: "client-serper-key-999", source: "client" });

  // Clave antigua del Editorial (settings.editorial.freepikApiKey) sigue valiendo.
  const legacy = { editorial: { freepikApiKey: encryptSecret("legacy-freepik-key") } };
  assert.deepEqual(resolveApiKey(legacy, "freepik"), { key: "legacy-freepik-key", source: "client" });

  // Un valor cifrado con otra clave no rompe: se ignora y se usa la de Negocio Vivo.
  assert.equal(resolveApiKey({ apiKeys: { serper: "basura.que.no-descifra" } }, "serper").source, "negociovivo");
  delete process.env.SERPER_API_KEY;
});

test("applyApiKeysPatch: cifra, quita (también la antigua) y valida", async () => {
  const { applyApiKeysPatch, resolveApiKey, ApiKeyValidationError } = await import("../lib/api-keys");
  const { encryptSecret } = await import("../lib/ai/crypto");
  const settings: Record<string, any> = { editorial: { imageModel: "x", freepikApiKey: encryptSecret("old-freepik-key") }, otra: 1 };
  const changed = applyApiKeysPatch(settings, { anthropic: "sk-ant-api03-abcdefghijkl", freepik: null, nope: "x" });
  assert.deepEqual(changed, ["anthropic", "freepik"]);
  assert.ok(!JSON.stringify(settings).includes("sk-ant-api03-abcdefghijkl"), "la clave no se guarda en claro");
  assert.equal(settings.editorial.freepikApiKey, undefined);
  assert.equal(settings.editorial.imageModel, "x");
  assert.equal(settings.otra, 1);
  assert.equal(resolveApiKey(settings, "freepik").source, process.env.FREEPIK_API_KEY ? "negociovivo" : "none");
  assert.throws(() => applyApiKeysPatch(settings, { openai: "con espacios dentro" }), ApiKeyValidationError);
  assert.throws(() => applyApiKeysPatch(settings, { openai: "corta" }), ApiKeyValidationError);
  assert.throws(() => applyApiKeysPatch(settings, { elevenlabsVoiceId: "voz con espacios" }), ApiKeyValidationError);
  applyApiKeysPatch(settings, { elevenlabsVoiceId: "AbCdEf123456" });
  assert.equal(settings.apiKeys.elevenlabsVoiceId, "AbCdEf123456");
});

test("apiKeysStatus: solo máscara, nunca la clave", async () => {
  const { applyApiKeysPatch, apiKeysStatus } = await import("../lib/api-keys");
  process.env.ANTHROPIC_API_KEY = "sk-ant-negociovivo-000000";
  const settings: Record<string, any> = {};
  applyApiKeysPatch(settings, { openai: "sk-proj-1234567890abcdef" });
  const st = apiKeysStatus(settings);
  assert.equal(st.keys.openai.source, "client");
  assert.equal(st.keys.openai.masked, "sk-p…cdef");
  assert.equal(st.keys.anthropic.source, "negociovivo");
  assert.equal(st.keys.anthropic.masked, "");
  assert.ok(!JSON.stringify(st).includes("1234567890"));
  assert.ok(!JSON.stringify(st).includes("negociovivo-000000"));
  delete process.env.ANTHROPIC_API_KEY;
});

test("Publicador SEO usa la clave de Serper del cliente", async () => {
  const { applyApiKeysPatch } = await import("../lib/api-keys");
  const { seoBlogSettingsFrom } = await import("../lib/seo-blog/settings");
  const settings: Record<string, any> = {};
  applyApiKeysPatch(settings, { serper: "client-serper-abc123" });
  assert.equal(seoBlogSettingsFrom(settings).serperApiKey, "client-serper-abc123");
  assert.equal(seoBlogSettingsFrom({}).serperApiKey, process.env.SERPER_API_KEY || null);
});
