import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanPushName,
  isPlaceholderName,
  bodyFingerprint,
  classifyReplyOutcome,
  containsLink,
  isOptOutMessage,
  similarity,
} from "../lib/inbox/text";
import {
  buildLearningPrompt,
  learningStats,
  selectLearningExamples,
  shouldRefreshStyleGuide,
  type LearningRow,
} from "../lib/inbox/learning-core";
import {
  extractAck,
  extractMessageId,
  extractSession,
  isApiSent,
} from "../lib/inbox/webhook-payload";

const NOW = new Date("2026-10-06T09:00:00Z");

test("clasifica lo que hizo la persona con la propuesta de la IA", () => {
  assert.equal(classifyReplyOutcome(null, "Hola!").outcome, "written");
  assert.equal(
    classifyReplyOutcome("Hola Ana, ¿te viene bien el jueves a las 10:00?", "Hola Ana, ¿te viene bien el jueves a las 10:00?").outcome,
    "accepted"
  );
  assert.equal(
    classifyReplyOutcome(
      "Hola Ana, ¿te viene bien el jueves a las 10:00?",
      "Hola Ana!! ¿Te viene bien el jueves a las 10:30? 😊"
    ).outcome,
    "edited"
  );
  assert.equal(
    classifyReplyOutcome("Hola Ana, ¿te viene bien el jueves a las 10:00?", "Te llamo ahora mismo y lo vemos").outcome,
    "rewritten"
  );
  assert.ok(similarity("abc", "abc") === 1);
  assert.ok(similarity("", "algo") === 0);
});

test("detecta bajas explícitas sin confundir un «no me interesa»", () => {
  for (const text of ["STOP", "Baja", "quiero darme de baja", "No me escribáis más", "dejad de escribirme", "no quiero recibir más mensajes", "No me escribas", "no me escribáis por favor"]) {
    assert.equal(isOptOutMessage(text), true, text);
  }
  assert.equal(isOptOutMessage("quiero darme de baja de los mensajes"), true);
  for (const text of [
    "no me interesa ahora",
    "¿Hacéis bajas laborales?",
    "Hola, quería pedir cita",
    "no me escribas por la mañana porfa",
    "quiero darme de baja del gimnasio, ¿cómo lo hago?",
    "solicito la baja de mi bono",
  ]) {
    assert.equal(isOptOutMessage(text), false, text);
  }
});

test("enlaces y huellas", () => {
  assert.ok(containsLink("visita https://x.com"));
  assert.ok(containsLink("en negociovivo.com tienes info"));
  assert.equal(containsLink("nos vemos a las 10.30"), false);
  assert.equal(bodyFingerprint("Cita el 12 a las 10:30"), bodyFingerprint("cita el 14 a las 11:00"));
});

const row = (over: Partial<LearningRow>): LearningRow => ({
  phone: "34600000001",
  lineId: "l1",
  customerText: "Hola, ¿cuánto cuesta la limpieza dental?",
  aiDraft: null,
  finalText: "Hola! La limpieza son 45 €. ¿Te busco hueco?",
  outcome: "written",
  createdAt: new Date("2026-10-01T10:00:00Z"),
  ...over,
});

test("elige los ejemplos más parecidos al mensaje actual y descarta su propio hilo", () => {
  const rows = [
    row({}),
    row({ phone: "34600000002", customerText: "¿Abrís el sábado?", finalText: "Sí, de 10 a 14." }),
    row({ phone: "34600000003", customerText: "Precio de la limpieza dental por favor", finalText: "Son 45 € 😊", outcome: "edited", aiDraft: "El precio es 45 euros." }),
    row({ phone: "34699999999", customerText: "limpieza dental precio", finalText: "propio hilo" }),
  ];
  const examples = selectLearningExamples(
    rows,
    { text: "Buenas, ¿qué precio tiene la limpieza dental?", phone: "34699999999", lineId: "l1" },
    NOW,
    2
  );
  assert.equal(examples.length, 2);
  assert.ok(examples.every((e) => e.phone !== "34699999999"));
  assert.match(examples[0].customerText, /limpieza/i);

  const prompt = buildLearningPrompt({ styleGuide: "- Tutea siempre", examples });
  assert.match(prompt, /GUÍA DE ESTILO/);
  assert.match(prompt, /CORRECCIONES/);
  assert.match(prompt, /nunca copies nombres/);
});

test("la guía de estilo se refresca con 3 muestras la primera vez y luego cada 8", () => {
  assert.equal(shouldRefreshStyleGuide({ pendingSamples: 3, refreshedAt: null, locked: false }), true);
  assert.equal(shouldRefreshStyleGuide({ pendingSamples: 5, refreshedAt: NOW, locked: false }), false);
  assert.equal(shouldRefreshStyleGuide({ pendingSamples: 8, refreshedAt: NOW, locked: false }), true);
  assert.equal(shouldRefreshStyleGuide({ pendingSamples: 50, refreshedAt: NOW, locked: true }), false);
});

test("estadísticas de aprendizaje", () => {
  const stats = learningStats([
    { outcome: "accepted" },
    { outcome: "accepted" },
    { outcome: "edited" },
    { outcome: "rewritten" },
    { outcome: "written" },
    { outcome: "phone" },
  ]);
  assert.equal(stats.acceptanceRate, 50);
  assert.equal(stats.usefulRate, 75);
  assert.equal(stats.total, 6);
});

test("lee sesión, id, ack y origen de los eventos de WAHA", () => {
  assert.equal(extractSession({ session: "paula-abc-12f" }), "paula-abc-12f");
  assert.equal(extractSession({}), null);
  assert.equal(extractMessageId({ id: "true_346@c.us_ABC" }), "true_346@c.us_ABC");
  assert.equal(extractMessageId({ id: { _serialized: "false_1@c.us_X" } }), "false_1@c.us_X");
  assert.equal(extractAck({ ack: 3 }), 3);
  assert.equal(extractAck({}), null);
  assert.equal(isApiSent({ source: "api" }), true);
  assert.equal(isApiSent({ source: "app" }), false);
});

test("nombres: detecta nombres que son números o identificadores y limpia el de WhatsApp", () => {
  assert.equal(isPlaceholderName("123456789012345@lid"), true);
  assert.equal(isPlaceholderName("34611111111", "34611111111"), true);
  assert.equal(isPlaceholderName("+34 611 111 111"), true);
  assert.equal(isPlaceholderName(""), true);
  assert.equal(isPlaceholderName("Lucía Pérez"), false);
  assert.equal(cleanPushName("  Aom  "), "Aom");
  assert.equal(cleanPushName("🙂🙂"), null);
  assert.equal(cleanPushName("+34 600 000 000"), null);
  assert.equal(cleanPushName("x".repeat(80))?.length, 60);
});

test("avatar neutro cuando no hay nombre real", async () => {
  const { initials, displayName, firstRealName } = await import("../components/inbox/ui");
  assert.equal(initials("Número oculto (WhatsApp)"), "#");
  assert.equal(initials("+34 611 111 111"), "#");
  assert.equal(initials("Aom"), "A");
  assert.equal(firstRealName("98765@lid", null, "Chuty"), "Chuty");
  assert.equal(displayName(firstRealName("98765@lid", null), "98765@lid"), "Número oculto (WhatsApp)");
});

test("WAHA: nombre de perfil y teléfono real de un @lid, y pushName de cada motor", async () => {
  const { pickContactName, pickLidPhone } = await import("../lib/waha");
  const { extractPushName } = await import("../lib/inbox/webhook-payload");
  assert.equal(pickContactName({ id: "1@c.us", pushname: "Chuty", name: null }), "Chuty");
  assert.equal(pickContactName({ id: "1@c.us" }), null);
  assert.equal(pickLidPhone({ lid: "98765@lid", pn: "34677123456@c.us" }), "34677123456");
  assert.equal(pickLidPhone({ lid: "98765@lid", pn: null }), null);
  assert.equal(extractPushName({ _data: { pushName: "Aom" } }), "Aom");
  assert.equal(extractPushName({ _data: { Info: { PushName: "Pedro" } } }), "Pedro");
  assert.equal(extractPushName({ _data: { notifyName: " Ana " } }), "Ana");
  assert.equal(extractPushName({}), undefined);
});
