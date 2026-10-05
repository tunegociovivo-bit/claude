import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSend,
  isSevereSendError,
  lineRiskScore,
  paceGapMs,
  readingDelayMs,
  typingDelayMs,
  warmupNewChatCap,
  type LineSafetyState,
  type SafetyCounters,
} from "../lib/inbox/safety";
import { madridDayStart, madridParts, nextWindowStart } from "../lib/inbox/time";

// Martes 6 de octubre de 2026, 11:00 en Madrid (09:00 UTC)
const NOW = new Date("2026-10-06T09:00:00Z");
const fixed = () => 0.5;

const line = (over: Partial<LineSafetyState> = {}): LineSafetyState => ({
  active: true,
  pausedUntil: null,
  lastStatus: "WORKING",
  warmupSince: new Date("2026-01-01T00:00:00Z"),
  dailyLimit: 200,
  hourlyLimit: 45,
  newChatsPerDay: 0,
  lastSendAt: null,
  ...over,
});

const counters = (over: Partial<SafetyCounters> = {}): SafetyCounters => ({
  sentLastHour: 0,
  oldestInLastHour: null,
  sentToday: 0,
  newChatsToday: 0,
  identicalOtherChats: 0,
  outboundSinceLastInbound: 0,
  ...over,
});

const replying = { optedOut: false, lastInboundAt: new Date(NOW.getTime() - 60_000) };

function decide(opts: {
  line?: Partial<LineSafetyState>;
  counters?: Partial<SafetyCounters>;
  conversation?: { optedOut: boolean; optedOutAt?: Date | null; lastInboundAt: Date | null };
  origin?: "auto" | "manual";
  body?: string;
  now?: Date;
}) {
  return evaluateSend({
    line: line(opts.line),
    counters: counters(opts.counters),
    conversation: opts.conversation ?? replying,
    intent: { origin: opts.origin ?? "manual", body: opts.body ?? "Hola, te confirmo la cita del jueves." },
    now: opts.now ?? NOW,
    rng: fixed,
  });
}

test("responder a quien ha escrito está permitido y sin espera si el número está libre", () => {
  const d = decide({});
  assert.equal(d.kind, "allow");
  if (d.kind === "allow") {
    assert.equal(d.cold, false);
    assert.equal(d.notBefore.getTime(), NOW.getTime());
  }
});

test("una baja bloquea cualquier envío, también el manual", () => {
  const d = decide({ conversation: { optedOut: true, lastInboundAt: NOW } });
  assert.equal(d.kind, "block");
  assert.equal(d.kind === "block" && d.code, "OPTED_OUT");
});

test("tras una baja, una persona puede contestar si el cliente volvió a escribir; la IA nunca", () => {
  const optedOutAt = new Date(NOW.getTime() - 3600_000);
  const rewrote = { optedOut: true, optedOutAt, lastInboundAt: new Date(NOW.getTime() - 60_000) };
  assert.equal(decide({ conversation: rewrote }).kind, "allow");
  assert.equal(decide({ conversation: rewrote, origin: "auto" }).kind, "block");
  const silent = { optedOut: true, optedOutAt, lastInboundAt: new Date(optedOutAt.getTime() - 1000) };
  assert.equal(decide({ conversation: silent }).kind, "block");
});

test("por defecto los números son de «solo responder»: no se escribe en frío", () => {
  const d = decide({ conversation: { optedOut: false, lastInboundAt: null } });
  assert.equal(d.kind === "block" && d.code, "COLD_BLOCKED");
});

test("la IA nunca inicia conversaciones aunque el número lo permita", () => {
  const d = decide({ origin: "auto", line: { newChatsPerDay: 10 }, conversation: { optedOut: false, lastInboundAt: null } });
  assert.equal(d.kind === "block" && d.code, "AUTO_COLD");
});

test("un cliente que escribió hace más de 30 días cuenta como conversación en frío", () => {
  const old = new Date(NOW.getTime() - 31 * 86_400_000);
  const d = decide({ conversation: { optedOut: false, lastInboundAt: old } });
  assert.equal(d.kind === "block" && d.code, "COLD_BLOCKED");
});

test("en frío: sin enlaces en el primer mensaje y con cupo con calentamiento", () => {
  const cold = { optedOut: false, lastInboundAt: null };
  const link = decide({ line: { newChatsPerDay: 10 }, conversation: cold, body: "Mira nuestra web www.ejemplo.com" });
  assert.equal(link.kind === "block" && link.code, "FIRST_LINK");

  const fresh = decide({
    line: { newChatsPerDay: 20, warmupSince: new Date(NOW.getTime() - 86_400_000) },
    counters: { newChatsToday: 6 },
    conversation: cold,
  });
  assert.equal(fresh.kind, "defer");
  assert.equal(fresh.kind === "defer" && fresh.code, "COLD_LIMIT");

  const ok = decide({
    line: { newChatsPerDay: 10, lastSendAt: new Date(NOW.getTime() - 1_000) },
    conversation: cold,
    body: "Hola Marta, te escribo por tu consulta.",
  });
  assert.equal(ok.kind, "allow");
  if (ok.kind === "allow") {
    assert.equal(ok.cold, true);
    assert.ok(ok.notBefore.getTime() >= NOW.getTime() + 44_000, "separación larga en frío");
  }
});

test("en frío fuera de horario comercial se programa para la siguiente franja", () => {
  const sundayNight = new Date("2026-10-04T21:30:00Z"); // domingo 23:30 Madrid
  const d = decide({
    now: sundayNight,
    line: { newChatsPerDay: 10 },
    conversation: { optedOut: false, lastInboundAt: null },
    body: "Hola, te escribo por la reserva.",
  });
  assert.equal(d.kind, "allow");
  if (d.kind === "allow") {
    const p = madridParts(d.notBefore);
    assert.equal(p.weekday, 1);
    assert.equal(p.hour, 9);
  }
});

test("número desactivado, en pausa o desconectado", () => {
  assert.equal(decide({ line: { active: false } }).kind, "block");
  const paused = decide({ line: { pausedUntil: new Date(NOW.getTime() + 600_000), pauseReason: "fallos" } });
  assert.equal(paused.kind === "defer" && paused.code, "LINE_PAUSED");
  const down = decide({ line: { lastStatus: "SCAN_QR_CODE" } });
  assert.equal(down.kind === "defer" && down.code, "SESSION_DOWN");
});

test("ráfagas sin respuesta del cliente: la IA para a los 2, la persona a los 5", () => {
  assert.equal(decide({ origin: "auto", counters: { outboundSinceLastInbound: 2 } }).kind, "block");
  assert.equal(decide({ origin: "manual", counters: { outboundSinceLastInbound: 2 } }).kind, "allow");
  const flood = decide({ origin: "manual", counters: { outboundSinceLastInbound: 5 } });
  assert.equal(flood.kind === "block" && flood.code, "CHAT_FLOOD");
});

test("el mismo texto largo a muchos chats se bloquea; un «gracias» no", () => {
  const blast = decide({ counters: { identicalOtherChats: 3 }, body: "Oferta especial solo esta semana para clientes" });
  assert.equal(blast.kind === "block" && blast.code, "DUPLICATE_BLAST");
  assert.equal(decide({ counters: { identicalOtherChats: 9 }, body: "¡Gracias!" }).kind, "allow");
});

test("límites por hora y por día aplazan en vez de perder el mensaje", () => {
  const hourly = decide({
    counters: { sentLastHour: 45, oldestInLastHour: new Date(NOW.getTime() - 50 * 60_000) },
  });
  assert.equal(hourly.kind, "defer");
  if (hourly.kind === "defer") {
    assert.equal(hourly.code, "HOURLY_LIMIT");
    assert.ok(hourly.retryAt.getTime() > NOW.getTime() + 10 * 60_000);
  }
  const daily = decide({ counters: { sentToday: 200 } });
  assert.equal(daily.kind === "defer" && daily.code, "DAILY_LIMIT");
  if (daily.kind === "defer") {
    const p = madridParts(daily.retryAt);
    assert.equal(p.day, 7);
    assert.equal(p.hour, 8);
  }
});

test("ritmo humano: se encadena tras el último envío del número", () => {
  const last = new Date(NOW.getTime() - 1_000);
  const d = decide({ origin: "auto", line: { lastSendAt: last } });
  assert.equal(d.kind, "allow");
  if (d.kind === "allow") assert.equal(d.notBefore.getTime(), last.getTime() + paceGapMs("auto", false, fixed));
});

test("calentamiento: 25% el primer día y 100% a los 14 días", () => {
  assert.equal(warmupNewChatCap(0, 30), 0);
  assert.equal(warmupNewChatCap(20, 0), 5);
  assert.equal(warmupNewChatCap(20, 7), 13);
  assert.equal(warmupNewChatCap(20, 14), 20);
  assert.equal(warmupNewChatCap(2, 0), 1);
});

test("retrasos humanos acotados", () => {
  assert.ok(readingDelayMs("hola", fixed) >= 2_000);
  assert.ok(readingDelayMs("x".repeat(5000), () => 1) <= 10_801);
  assert.ok(typingDelayMs("x".repeat(5000), "auto", () => 1) <= 13_801);
  assert.ok(typingDelayMs("ok", "manual", () => 0) >= 1_000);
  assert.ok(paceGapMs("manual", true, () => 0) >= 45_000);
});

test("indicador de riesgo", () => {
  const healthy = lineRiskScore({ line: line(), now: NOW, sentToday: 10, sent24h: 30, failed24h: 0, optOuts7d: 0, coldToday: 0 });
  assert.equal(healthy.level, "bajo");
  const bad = lineRiskScore({
    line: line({ lastStatus: "FAILED", warmupSince: NOW }),
    now: NOW,
    sentToday: 190,
    sent24h: 10,
    failed24h: 10,
    optOuts7d: 2,
    coldToday: 0,
  });
  assert.equal(bad.level, "alto");
  assert.ok(bad.reasons.length >= 3);
});

test("errores graves de WAHA pausan el número (sin falsos positivos por teléfonos)", () => {
  assert.ok(isSevereSendError("WAHA sendText 401: Unauthorized", 401));
  assert.ok(isSevereSendError("Session is not authorized, logged out", 422));
  assert.equal(isSevereSendError("WAHA sendText 500: timeout", 500), false);
  assert.equal(isSevereSendError("WAHA sendText 422: chat 34640140123@c.us not found", 422), false);
  assert.equal(isSevereSendError("connection closed", null), false);
});

test("al enviar se exige el ritmo mínimo, no uno aleatorio", () => {
  const last = new Date(NOW.getTime() - 4_000);
  const d = evaluateSend({
    line: line({ lastSendAt: last }),
    counters: counters(),
    conversation: replying,
    intent: { origin: "manual", body: "hola" },
    now: NOW,
    rng: () => 1,
    pacing: "floor",
  });
  assert.equal(d.kind === "allow" && d.notBefore.getTime(), NOW.getTime());
});

test("reloj de Madrid: inicio del día y franjas", () => {
  const start = madridDayStart(NOW);
  assert.equal(start.toISOString(), "2026-10-05T22:00:00.000Z");
  const inside = nextWindowStart(NOW, { startHour: 9, endHour: 21, days: [1, 2, 3, 4, 5, 6] });
  assert.equal(inside.getTime(), NOW.getTime());
});
