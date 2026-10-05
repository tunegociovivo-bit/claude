// ---------------------------------------------------------------------------
// Motor anti-baneo (puro, sin BD). Decide si un mensaje puede salir, cuándo,
// y con qué "ritmo humano". Lo usan la cola de salida y los tests.
//
// Principios (aprendidos en el Hub con 9 números en producción):
//  - Responder a quien te escribe es seguro; escribir en frío es lo que banea.
//    Por defecto cada número está en modo «solo responder».
//  - Nunca ráfagas: separación aleatoria entre envíos del mismo número y
//    simulación de lectura + «escribiendo…» antes de cada mensaje.
//  - Nada de texto idéntico a muchos chats, ni enlaces en un primer mensaje.
//  - Una baja («stop», «no me escribas más») corta todo envío a ese chat.
//  - Un número que empieza a fallar se pausa solo (cortacircuitos).
// ---------------------------------------------------------------------------

import { containsLink } from "@/lib/inbox/text";
import { madridParts, madridWallTime, nextWindowStart } from "@/lib/inbox/time";

export type Rng = () => number;

export type LineSafetyState = {
  active: boolean;
  pausedUntil: Date | null;
  pauseReason?: string | null;
  lastStatus: string | null;
  warmupSince: Date;
  dailyLimit: number;
  hourlyLimit: number;
  newChatsPerDay: number;
  lastSendAt: Date | null; // último envío hecho o ya programado en este número
};

export type SafetyCounters = {
  sentLastHour: number;
  oldestInLastHour: Date | null;
  sentToday: number;
  newChatsToday: number;
  identicalOtherChats: number; // chats distintos que recibieron el mismo texto en la última hora
  outboundSinceLastInbound: number; // mensajes nuestros seguidos sin respuesta del cliente
};

export type ConversationSafety = {
  optedOut: boolean;
  optedOutAt?: Date | null;
  lastInboundAt: Date | null;
};

// Tras una baja, una PERSONA puede contestar si el cliente volvió a escribir
// por su cuenta; la IA nunca.
export function optOutBlocks(conv: ConversationSafety, origin: "auto" | "manual"): boolean {
  if (!conv.optedOut) return false;
  if (origin === "auto") return true;
  const rewrote = Boolean(conv.lastInboundAt && conv.optedOutAt && conv.lastInboundAt.getTime() > conv.optedOutAt.getTime());
  return !rewrote;
}

export type SendIntent = {
  origin: "auto" | "manual";
  body: string;
};

export type SafetyDecision =
  | { kind: "allow"; notBefore: Date; cold: boolean; warnings: string[] }
  | { kind: "defer"; code: string; reason: string; retryAt: Date; cold: boolean }
  | { kind: "block"; code: string; reason: string };

export const COLD_AFTER_DAYS = 30;
export const PROACTIVE_WINDOW = { startHour: 9, endHour: 21, days: [1, 2, 3, 4, 5, 6] };
const DAY = 86_400_000;

export function lineAgeDays(line: Pick<LineSafetyState, "warmupSince">, now: Date): number {
  return Math.max(0, (now.getTime() - line.warmupSince.getTime()) / DAY);
}

// Rampa de calentamiento para conversaciones iniciadas por nosotros: un número
// nuevo empieza al 25% de su cupo y llega al 100% en 14 días.
export function warmupNewChatCap(newChatsPerDay: number, ageDays: number): number {
  if (newChatsPerDay <= 0) return 0;
  if (ageDays >= 14) return newChatsPerDay;
  const factor = 0.25 + 0.75 * (ageDays / 14);
  return Math.max(1, Math.min(newChatsPerDay, Math.round(newChatsPerDay * factor)));
}

function between(rng: Rng, min: number, max: number) {
  return Math.round(min + (max - min) * rng());
}

// Separación mínima entre dos envíos del mismo número.
export function paceGapMs(origin: "auto" | "manual", cold: boolean, rng: Rng = Math.random): number {
  if (cold) return between(rng, 45_000, 120_000);
  return origin === "auto" ? between(rng, 6_000, 14_000) : between(rng, 3_000, 8_000);
}

// Separación mínima garantizada (se comprueba otra vez justo antes de enviar).
export function paceFloorMs(origin: "auto" | "manual", cold: boolean): number {
  return paceGapMs(origin, cold, () => 0);
}

// Tiempo que una persona tardaría en leer el mensaje del cliente antes de contestar.
export function readingDelayMs(inboundText: string, rng: Rng = Math.random): number {
  const base = Math.min(9_000, Math.max(2_000, 1_500 + (inboundText?.length ?? 0) * 25));
  return Math.round(base * (0.8 + 0.4 * rng()));
}

// Duración del «escribiendo…» proporcional a la longitud de la respuesta.
export function typingDelayMs(text: string, origin: "auto" | "manual", rng: Rng = Math.random): number {
  const len = text?.length ?? 0;
  const base =
    origin === "auto"
      ? Math.min(12_000, Math.max(1_500, len * 55))
      : Math.min(4_500, Math.max(1_200, len * 25));
  return Math.round(base * (0.85 + 0.3 * rng()));
}

export function isColdConversation(conv: ConversationSafety, now: Date): boolean {
  if (!conv.lastInboundAt) return true;
  return now.getTime() - conv.lastInboundAt.getTime() > COLD_AFTER_DAYS * DAY;
}

export function evaluateSend(input: {
  line: LineSafetyState;
  counters: SafetyCounters;
  conversation: ConversationSafety;
  intent: SendIntent;
  now: Date;
  rng?: Rng;
  // "schedule" (al encolar): separación aleatoria. "floor" (al enviar): mínimo garantizado.
  pacing?: "schedule" | "floor";
}): SafetyDecision {
  const { line, counters, conversation, intent, now } = input;
  const rng = input.rng ?? Math.random;
  const body = intent.body?.trim() ?? "";

  if (!body) return { kind: "block", code: "EMPTY", reason: "El mensaje está vacío." };
  if (body.length > 4000) {
    return { kind: "block", code: "TOO_LONG", reason: "El mensaje supera los 4.000 caracteres." };
  }
  if (optOutBlocks(conversation, intent.origin)) {
    return {
      kind: "block",
      code: "OPTED_OUT",
      reason: "Este cliente pidió no recibir más mensajes (baja). No se le escribe salvo que vuelva a escribir él.",
    };
  }
  if (!line.active) {
    return { kind: "block", code: "LINE_INACTIVE", reason: "Este número está desactivado para enviar." };
  }

  const cold = isColdConversation(conversation, now);

  if (line.pausedUntil && line.pausedUntil.getTime() > now.getTime()) {
    return {
      kind: "defer",
      code: "LINE_PAUSED",
      reason: `Número en pausa de seguridad${line.pauseReason ? `: ${line.pauseReason}` : ""}.`,
      retryAt: line.pausedUntil,
      cold,
    };
  }
  if (line.lastStatus && line.lastStatus !== "WORKING") {
    return {
      kind: "defer",
      code: "SESSION_DOWN",
      reason: `El WhatsApp de este número no está conectado (${line.lastStatus}).`,
      retryAt: new Date(now.getTime() + 2 * 60_000),
      cold,
    };
  }

  const warnings: string[] = [];
  const ageDays = lineAgeDays(line, now);
  let notBefore = now;

  if (cold) {
    if (intent.origin === "auto") {
      return {
        kind: "block",
        code: "AUTO_COLD",
        reason: "La IA nunca inicia conversaciones: solo responde a quien escribe.",
      };
    }
    if (line.newChatsPerDay <= 0) {
      return {
        kind: "block",
        code: "COLD_BLOCKED",
        reason:
          "Este número está en modo «solo responder»: el cliente tiene que escribir primero (protección anti-baneo).",
      };
    }
    const cap = warmupNewChatCap(line.newChatsPerDay, ageDays);
    if (counters.newChatsToday >= cap) {
      return {
        kind: "defer",
        code: "COLD_LIMIT",
        reason: `Cupo diario de conversaciones nuevas alcanzado (${cap}${cap < line.newChatsPerDay ? ", número en calentamiento" : ""}).`,
        retryAt: nextWindowStart(new Date(now.getTime() + 12 * 3600_000), PROACTIVE_WINDOW),
        cold,
      };
    }
    if (containsLink(body)) {
      return {
        kind: "block",
        code: "FIRST_LINK",
        reason: "No se envían enlaces en el primer mensaje a alguien que no te ha escrito (señal típica de spam).",
      };
    }
    const window = nextWindowStart(now, PROACTIVE_WINDOW);
    if (window.getTime() > now.getTime()) {
      notBefore = window;
      warnings.push("Fuera de horario comercial: se enviará al abrir la franja (9:00–21:00, L–S).");
    }
  }

  const floodLimit = intent.origin === "auto" ? 2 : 5;
  if (counters.outboundSinceLastInbound >= floodLimit) {
    return {
      kind: "block",
      code: "CHAT_FLOOD",
      reason:
        intent.origin === "auto"
          ? "La IA ya ha enviado varios mensajes seguidos sin respuesta del cliente."
          : `Ya hay ${counters.outboundSinceLastInbound} mensajes seguidos sin respuesta del cliente: espera a que conteste.`,
    };
  }

  if (counters.identicalOtherChats >= 3 && body.length >= 25) {
    return {
      kind: "block",
      code: "DUPLICATE_BLAST",
      reason: "Este mismo texto ya se ha enviado a varios chats en la última hora. Personalízalo para no parecer un envío masivo.",
    };
  }

  if (counters.sentToday >= line.dailyLimit) {
    const p = madridParts(now);
    return {
      kind: "defer",
      code: "DAILY_LIMIT",
      reason: `Límite diario del número alcanzado (${line.dailyLimit} mensajes).`,
      retryAt: madridWallTime(p.year, p.month, p.day + 1, 8, between(rng, 0, 20)),
      cold,
    };
  }

  if (counters.sentLastHour >= line.hourlyLimit) {
    const freeAt = counters.oldestInLastHour
      ? new Date(counters.oldestInLastHour.getTime() + 3600_000 + between(rng, 5_000, 60_000))
      : new Date(now.getTime() + 10 * 60_000);
    return {
      kind: "defer",
      code: "HOURLY_LIMIT",
      reason: `Límite por hora del número alcanzado (${line.hourlyLimit}/h): se envía en cuanto haya hueco.`,
      retryAt: freeAt,
      cold,
    };
  }

  if (line.lastSendAt) {
    const gap = input.pacing === "floor" ? paceFloorMs(intent.origin, cold) : paceGapMs(intent.origin, cold, rng);
    const paced = new Date(line.lastSendAt.getTime() + gap);
    if (paced.getTime() > notBefore.getTime()) notBefore = paced;
  }

  if (ageDays < 3) warnings.push("Número conectado hace menos de 3 días: mantén un volumen bajo.");
  if (counters.sentToday >= line.dailyLimit * 0.8) warnings.push("El número está cerca de su límite diario.");

  return { kind: "allow", notBefore, cold, warnings };
}

// Indicador 0–100 de riesgo de baneo de un número (para el panel).
export function lineRiskScore(input: {
  line: LineSafetyState;
  now: Date;
  sentToday: number;
  sent24h: number;
  failed24h: number;
  optOuts7d: number;
  coldToday: number;
}): { score: number; level: "bajo" | "medio" | "alto"; reasons: string[] } {
  const { line, now } = input;
  let score = 0;
  const reasons: string[] = [];
  if (line.lastStatus && line.lastStatus !== "WORKING") {
    score += 40;
    reasons.push("WhatsApp no conectado");
  }
  if (line.pausedUntil && line.pausedUntil.getTime() > now.getTime()) {
    score += 25;
    reasons.push("en pausa de seguridad");
  }
  const age = lineAgeDays(line, now);
  if (age < 3) {
    score += 20;
    reasons.push("número recién conectado");
  } else if (age < 14) {
    score += 10;
    reasons.push("en calentamiento");
  }
  const attempts = input.sent24h + input.failed24h;
  if (attempts >= 3 && input.failed24h > 0) {
    const rate = input.failed24h / attempts;
    score += Math.round(rate * 30);
    if (rate >= 0.2) reasons.push(`${Math.round(rate * 100)}% de envíos fallidos`);
  }
  if (input.optOuts7d > 0) {
    score += Math.min(30, input.optOuts7d * 10);
    reasons.push(`${input.optOuts7d} baja(s) en 7 días`);
  }
  if (line.dailyLimit > 0) {
    const usage = Math.min(1, input.sentToday / line.dailyLimit);
    score += Math.round(usage * 15);
    if (usage >= 0.8) reasons.push("cerca del límite diario");
  }
  const coldCap = warmupNewChatCap(line.newChatsPerDay, age);
  if (coldCap > 0 && input.coldToday > 0) score += Math.round(Math.min(1, input.coldToday / coldCap) * 10);
  score = Math.max(0, Math.min(100, score));
  return { score, level: score < 30 ? "bajo" : score < 60 ? "medio" : "alto", reasons };
}

// Errores de WAHA que indican sesión cerrada o número restringido: pausa larga.
// Se mira el código HTTP de forma estructurada (nunca dígitos sueltos del
// texto, que pueden ser un teléfono) y frases inequívocas.
export function isSevereSendError(message: string, status: number | null = null): boolean {
  if (status === 401 || status === 403) return true;
  return /logged ?out|not[- ]?authori[sz]ed|unauthori[sz]ed|\bbanned\b|account (?:is )?restricted|number (?:is )?restricted/i.test(
    message || ""
  );
}
