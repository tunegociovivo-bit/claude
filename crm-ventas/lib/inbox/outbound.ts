import "server-only";
import type { OutboundMessage, WhatsappLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendSeen, sendText, setTyping, WahaSendError } from "@/lib/waha";
import { bodyFingerprint } from "@/lib/inbox/text";
import { madridDayStart } from "@/lib/inbox/time";
import {
  evaluateSend,
  isSevereSendError,
  typingDelayMs,
  type SafetyCounters,
  type SafetyDecision,
} from "@/lib/inbox/safety";
import { ensurePrimaryLine, refreshLineStatus, toSafetyState } from "@/lib/inbox/lines";
import { touchConversationOnOutbound } from "@/lib/inbox/conversations";
import { recordHumanReply } from "@/lib/inbox/learning";
import { notifyWorkspaceUrgentAlert } from "@/lib/urgent-alert-delivery";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_ATTEMPTS = 3;
const LINE_LOCK_MS = 60_000;
const PENDING = ["queued", "sending"];

export class OutboundError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "ERROR") {
    super(message);
  }
}

// Contadores para las reglas anti-baneo.
//  - "enqueue": cuenta también lo que ya está en cola (para no aceptar más de lo que cabe).
//  - "send": solo lo enviado de verdad (comprobación definitiva justo antes de enviar).
async function safetyCounters(opts: {
  mode: "enqueue" | "send";
  line: WhatsappLine;
  conversationId: string;
  workspaceId: string;
  phone: string;
  lastInboundAt: Date | null;
  fingerprint: string;
  now: Date;
  excludeId?: string;
}): Promise<SafetyCounters> {
  const hourAgo = new Date(opts.now.getTime() - 3600_000);
  const dayStart = madridDayStart(opts.now);
  const exclude = opts.excludeId ? { NOT: { id: opts.excludeId } } : {};
  const sent = { lineId: opts.line.id, status: "sent" };
  const pendingOnLine = { lineId: opts.line.id, status: { in: PENDING }, ...exclude };
  const withPending = opts.mode === "enqueue";
  const [sentLastHour, oldest, sentToday, pendingTotal, coldSent, coldPending, identical, outboundMessages, queuedHere] =
    await Promise.all([
      prisma.outboundMessage.count({ where: { ...sent, sentAt: { gte: hourAgo } } }),
      prisma.outboundMessage.findFirst({
        where: { ...sent, sentAt: { gte: hourAgo } },
        orderBy: { sentAt: "asc" },
        select: { sentAt: true },
      }),
      prisma.outboundMessage.count({ where: { ...sent, sentAt: { gte: dayStart } } }),
      withPending ? prisma.outboundMessage.count({ where: pendingOnLine }) : Promise.resolve(0),
      prisma.outboundMessage.count({ where: { ...sent, cold: true, sentAt: { gte: dayStart } } }),
      withPending ? prisma.outboundMessage.count({ where: { ...pendingOnLine, cold: true } }) : Promise.resolve(0),
      prisma.outboundMessage.findMany({
        where: {
          lineId: opts.line.id,
          fingerprint: opts.fingerprint,
          createdAt: { gte: hourAgo },
          status: { in: withPending ? ["queued", "sending", "sent"] : ["sent"] },
          NOT: { conversationId: opts.conversationId },
        },
        distinct: ["conversationId"],
        select: { conversationId: true },
      }),
      prisma.message.count({
        where: {
          workspaceId: opts.workspaceId,
          phone: opts.phone,
          direction: "out",
          ...(opts.lastInboundAt ? { createdAt: { gt: opts.lastInboundAt } } : {}),
        },
      }),
      withPending
        ? prisma.outboundMessage.count({
            where: { conversationId: opts.conversationId, status: { in: PENDING }, ...exclude },
          })
        : Promise.resolve(0),
    ]);
  return {
    sentLastHour,
    oldestInLastHour: oldest?.sentAt ?? null,
    sentToday: sentToday + pendingTotal,
    newChatsToday: coldSent + coldPending,
    identicalOtherChats: identical.length,
    outboundSinceLastInbound: outboundMessages + queuedHere,
  };
}

// Último envío hecho o ya programado en la línea (para encadenar el ritmo).
async function lastScheduledOnLine(line: WhatsappLine): Promise<Date | null> {
  const pending = await prisma.outboundMessage.findFirst({
    where: { lineId: line.id, status: { in: PENDING } },
    orderBy: { scheduledAt: "desc" },
    select: { scheduledAt: true },
  });
  const candidates = [line.lastSentAt, pending?.scheduledAt].filter((d): d is Date => Boolean(d));
  return candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;
}

export type EnqueueResult = {
  outbound: OutboundMessage;
  decision: SafetyDecision;
};

// Respuestas automáticas en cola que deben retirarse porque una persona
// ha tomado el chat (o la IA se ha apagado). Las críticas (confirman una cita
// ya creada) no se retiran.
export async function cancelQueuedAutoReplies(where: { conversationId?: string; lineId?: string }, reason: string) {
  return prisma.outboundMessage.updateMany({
    where: { ...where, origin: "auto", status: "queued", critical: false },
    data: { status: "canceled", lastError: reason },
  });
}

// Punto único de salida: valida reglas anti-baneo y deja el mensaje en cola.
export async function enqueueOutbound(opts: {
  workspaceId: string;
  conversationId: string;
  body: string;
  origin: "auto" | "manual";
  userId?: string | null;
  aiDraft?: string | null;
  replyToId?: string | null;
  idempotencyKey?: string | null;
  minDelayMs?: number;
  critical?: boolean;
}): Promise<EnqueueResult> {
  if (opts.idempotencyKey) {
    const existing = await prisma.outboundMessage.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) {
      if (existing.workspaceId !== opts.workspaceId) throw new OutboundError("Clave de idempotencia no válida", 409);
      return {
        outbound: existing,
        decision: { kind: "allow", notBefore: existing.scheduledAt, cold: existing.cold, warnings: [] },
      };
    }
  }
  const conversation = await prisma.conversation.findFirst({
    where: { id: opts.conversationId, workspaceId: opts.workspaceId },
  });
  if (!conversation) throw new OutboundError("Conversación no encontrada", 404, "NOT_FOUND");

  // Número de salida: el del mensaje al que se responde; si no, el último por
  // el que escribió el cliente. Nunca otro número distinto.
  let lineId = conversation.lineId;
  if (opts.replyToId) {
    const replyTo = await prisma.message.findFirst({
      where: { id: opts.replyToId, workspaceId: opts.workspaceId },
      select: { lineId: true },
    });
    if (replyTo?.lineId) lineId = replyTo.lineId;
  }
  let line = lineId
    ? await prisma.whatsappLine.findFirst({ where: { id: lineId, workspaceId: opts.workspaceId } })
    : await ensurePrimaryLine(opts.workspaceId);
  if (!line && lineId) {
    throw new OutboundError(
      "El número por el que escribió este cliente ya no está en la bandeja. Vuelve a conectarlo para responderle.",
      409,
      "LINE_REMOVED"
    );
  }
  if (!line) throw new OutboundError("No hay ningún número de WhatsApp conectado", 409, "NO_LINE");
  line = await refreshLineStatus(line);

  const now = new Date();
  const body = opts.body.trim();
  const fingerprint = bodyFingerprint(body);
  const counters = await safetyCounters({
    mode: "enqueue",
    line,
    conversationId: conversation.id,
    workspaceId: opts.workspaceId,
    phone: conversation.phone,
    lastInboundAt: conversation.lastInboundAt,
    fingerprint,
    now,
  });
  const decision = evaluateSend({
    line: toSafetyState(line, await lastScheduledOnLine(line)),
    counters,
    conversation: { optedOut: conversation.optedOut, lastInboundAt: conversation.lastInboundAt },
    intent: { origin: opts.origin, body },
    now,
  });

  const base = {
    workspaceId: opts.workspaceId,
    lineId: line.id,
    conversationId: conversation.id,
    phone: conversation.phone,
    chatId: conversation.chatId || conversation.phone,
    body,
    origin: opts.origin,
    critical: Boolean(opts.critical),
    fingerprint,
    aiDraft: opts.aiDraft ?? null,
    replyToId: opts.replyToId ?? null,
    userId: opts.userId ?? null,
    idempotencyKey: opts.idempotencyKey ?? null,
  };

  if (decision.kind === "block") {
    const outbound = await prisma.outboundMessage.create({
      data: { ...base, status: "blocked", lastError: `${decision.code}: ${decision.reason}`, idempotencyKey: null },
    });
    return { outbound, decision };
  }

  if (opts.origin === "manual") {
    // Una persona responde: lo que la IA tuviera programado para este chat sobra.
    await cancelQueuedAutoReplies({ conversationId: conversation.id }, "Sustituida por una respuesta del equipo");
  }

  const minAt = new Date(now.getTime() + (opts.minDelayMs ?? 0));
  const target = decision.kind === "defer" ? decision.retryAt : decision.notBefore;
  const scheduledAt = target.getTime() > minAt.getTime() ? target : minAt;
  const outbound = await prisma.outboundMessage.create({
    data: {
      ...base,
      cold: decision.cold,
      status: "queued",
      scheduledAt,
      lastError: decision.kind === "defer" ? `${decision.code}: ${decision.reason}` : null,
    },
  });
  return { outbound, decision };
}

async function pauseLine(line: WhatsappLine, minutes: number, reason: string) {
  const pausedUntil = new Date(Date.now() + minutes * 60_000);
  await prisma.whatsappLine.update({ where: { id: line.id }, data: { pausedUntil, pauseReason: reason } });
  await notifyWorkspaceUrgentAlert(
    line.workspaceId,
    "WHATSAPP_LINE_PAUSED",
    `Número «${line.label}»${line.phone ? ` (+${line.phone})` : ""} pausado ${minutes >= 60 ? `${Math.round(minutes / 60)} h` : `${minutes} min`}: ${reason}`
  ).catch(() => undefined);
}

const jitter = (ms: number) => Math.round(Math.random() * ms);

// Envía un mensaje de la cola con lectura + «escribiendo…» y registra el resultado.
// Antes de enviar vuelve a pasar TODAS las reglas con lo realmente enviado, con
// un solo envío a la vez por número (bloqueo en BD, válido entre instancias).
export async function processOutbound(id: string): Promise<OutboundMessage | null> {
  const now = new Date();
  const claimed = await prisma.outboundMessage.updateMany({
    where: { id, status: "queued", scheduledAt: { lte: now } },
    data: { status: "sending", claimedAt: now },
  });
  if (claimed.count === 0) return prisma.outboundMessage.findUnique({ where: { id } });
  const outbound = await prisma.outboundMessage.findUniqueOrThrow({ where: { id } });

  const requeue = (at: Date, reason: string) =>
    prisma.outboundMessage.update({
      where: { id },
      data: { status: "queued", scheduledAt: at, lastError: reason, claimedAt: null },
    });
  const close = (status: "failed" | "blocked" | "canceled", reason: string) =>
    prisma.outboundMessage.update({ where: { id }, data: { status, lastError: reason.slice(0, 500) } });

  const [conversation, lineRow] = await Promise.all([
    prisma.conversation.findUnique({ where: { id: outbound.conversationId } }),
    prisma.whatsappLine.findUnique({ where: { id: outbound.lineId } }),
  ]);
  if (!conversation || !lineRow) return close("failed", "La conversación o el número ya no existen");
  if (conversation.optedOut) return close("canceled", "OPTED_OUT: el cliente pidió la baja");
  if (!lineRow.active) return close("blocked", "LINE_INACTIVE: número desactivado");
  if (outbound.origin === "auto" && !outbound.critical) {
    if (lineRow.aiMode !== "auto") return close("canceled", "La IA automática se desactivó en este número");
    if (conversation.humanUntil && conversation.humanUntil.getTime() > now.getTime()) {
      return close("canceled", "Una persona ha tomado este chat");
    }
  }
  if (lineRow.pausedUntil && lineRow.pausedUntil.getTime() > now.getTime()) {
    return requeue(new Date(lineRow.pausedUntil.getTime() + jitter(90_000)), `LINE_PAUSED: ${lineRow.pauseReason ?? "pausa de seguridad"}`);
  }
  const line = await refreshLineStatus(lineRow, 30_000);
  if (line.lastStatus !== "WORKING") {
    if (now.getTime() - outbound.createdAt.getTime() > 6 * 3600_000) {
      return close("failed", `SESSION_DOWN: WhatsApp sin conexión (${line.lastStatus})`);
    }
    return requeue(new Date(now.getTime() + 2 * 60_000 + jitter(30_000)), `SESSION_DOWN: WhatsApp sin conexión (${line.lastStatus})`);
  }

  // Un solo envío a la vez por número.
  const locked = await prisma.whatsappLine.updateMany({
    where: { id: line.id, OR: [{ sendLockUntil: null }, { sendLockUntil: { lt: now } }] },
    data: { sendLockUntil: new Date(now.getTime() + LINE_LOCK_MS) },
  });
  if (locked.count === 0) return requeue(new Date(now.getTime() + 3_000 + jitter(2_000)), outbound.lastError ?? "");
  const unlock = () =>
    prisma.whatsappLine.update({ where: { id: line.id }, data: { sendLockUntil: null } }).catch(() => undefined);

  try {
    // Comprobación definitiva con lo realmente enviado (límites, ritmo, frío, duplicados).
    const fresh = await prisma.whatsappLine.findUniqueOrThrow({ where: { id: line.id } });
    const counters = await safetyCounters({
      mode: "send",
      line: fresh,
      conversationId: conversation.id,
      workspaceId: outbound.workspaceId,
      phone: outbound.phone,
      lastInboundAt: conversation.lastInboundAt,
      fingerprint: outbound.fingerprint ?? bodyFingerprint(outbound.body),
      now,
      excludeId: outbound.id,
    });
    const decision = evaluateSend({
      line: toSafetyState(fresh, fresh.lastSentAt),
      counters,
      conversation: { optedOut: conversation.optedOut, lastInboundAt: conversation.lastInboundAt },
      intent: { origin: outbound.origin === "auto" ? "auto" : "manual", body: outbound.body },
      now,
      pacing: "floor",
    });
    if (decision.kind === "block") return await close("blocked", `${decision.code}: ${decision.reason}`);
    if (decision.kind === "defer") {
      return await requeue(new Date(decision.retryAt.getTime() + jitter(90_000)), `${decision.code}: ${decision.reason}`);
    }
    if (decision.notBefore.getTime() > Date.now() + 500) {
      return await requeue(decision.notBefore, outbound.lastError ?? "");
    }

    // Simulación humana: marcar leído, «escribiendo…» y pausa proporcional.
    await sendSeen({ workspaceId: line.workspaceId, session: line.sessionName, chatId: outbound.chatId });
    await setTyping({ workspaceId: line.workspaceId, session: line.sessionName, chatId: outbound.chatId, typing: true });
    await sleep(typingDelayMs(outbound.body, outbound.origin === "auto" ? "auto" : "manual"));
    await setTyping({ workspaceId: line.workspaceId, session: line.sessionName, chatId: outbound.chatId, typing: false });

    let messageId: string;
    try {
      ({ messageId } = await sendText({
        workspaceId: line.workspaceId,
        to: outbound.chatId,
        text: outbound.body,
        session: line.sessionName,
      }));
    } catch (error) {
      return await handleSendFailure(outbound, line, error);
    }

    // Enviado: a partir de aquí NADA puede volver a ponerlo en cola.
    const sentAt = new Date();
    await prisma.outboundMessage.update({ where: { id }, data: { status: "sent", sentAt, lastError: null } });
    await prisma.whatsappLine
      .update({ where: { id: line.id }, data: { lastSentAt: sentAt, consecutiveFailures: 0 } })
      .catch(() => undefined);
    await recordSent(outbound, conversation, line, messageId, sentAt).catch((error) =>
      console.error("[inbox-outbound] enviado pero no se pudo registrar del todo:", error?.message)
    );
    return prisma.outboundMessage.findUnique({ where: { id } });
  } finally {
    await unlock();
  }
}

async function handleSendFailure(outbound: OutboundMessage, line: WhatsappLine, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  const status = error instanceof WahaSendError ? error.status : null;
  const ambiguous = error instanceof WahaSendError ? error.ambiguous : true;
  const failures = line.consecutiveFailures + 1;
  await prisma.whatsappLine.update({ where: { id: line.id }, data: { consecutiveFailures: failures, lastStatusAt: null } });
  if (isSevereSendError(reason, status)) {
    await pauseLine(line, 12 * 60, "WhatsApp rechazó el envío (sesión cerrada o número restringido). Revisa el móvil.");
  } else if (failures >= 3) {
    await pauseLine(line, 30, `${failures} envíos seguidos fallidos`);
  }
  const attempts = outbound.attempts + 1;
  if (ambiguous) {
    // Puede que haya salido: nunca se reintenta solo (evita duplicados al cliente).
    return prisma.outboundMessage.update({
      where: { id: outbound.id },
      data: {
        status: "failed",
        attempts,
        lastError: `No sabemos si llegó a enviarse (${reason.slice(0, 200)}). Revisa el chat en el móvil antes de reintentar.`,
      },
    });
  }
  if (attempts >= MAX_ATTEMPTS || isSevereSendError(reason, status)) {
    return prisma.outboundMessage.update({
      where: { id: outbound.id },
      data: { status: "failed", attempts, lastError: reason.slice(0, 500) },
    });
  }
  return prisma.outboundMessage.update({
    where: { id: outbound.id },
    data: {
      status: "queued",
      attempts,
      claimedAt: null,
      scheduledAt: new Date(Date.now() + 60_000 * attempts + jitter(20_000)),
      lastError: reason.slice(0, 500),
    },
  });
}

async function recordSent(
  outbound: OutboundMessage,
  conversation: { id: string; contactId: string | null },
  line: WhatsappLine,
  messageId: string,
  sentAt: Date
) {
  const message = await prisma.message.create({
    data: {
      workspaceId: outbound.workspaceId,
      contactId: conversation.contactId,
      phone: outbound.phone,
      direction: "out",
      body: outbound.body,
      externalId: messageId,
      lineId: line.id,
      ack: 1,
      createdAt: sentAt,
      meta: {
        outboundId: outbound.id,
        ...(outbound.origin === "auto" ? { sonia: true } : { manual: true, userId: outbound.userId }),
      },
    },
  });
  await prisma.outboundMessage.update({ where: { id: outbound.id }, data: { messageId: message.id } });
  await touchConversationOnOutbound({
    workspaceId: outbound.workspaceId,
    phone: outbound.phone,
    body: outbound.body,
    at: sentAt,
  });
  if (outbound.origin === "manual") {
    // Una persona respondió: el borrador queda resuelto y la IA automática
    // de este chat se aparta 2 h para no pisar a la persona.
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        aiDraft: null,
        aiDraftForId: null,
        aiStatus: "idle",
        humanUntil: new Date(sentAt.getTime() + 2 * 3600_000),
      },
    });
    await recordHumanReply({
      workspaceId: outbound.workspaceId,
      lineId: line.id,
      phone: outbound.phone,
      finalText: outbound.body,
      aiDraft: outbound.aiDraft,
      source: "crm",
      at: message.createdAt,
    }).catch((error) => console.error("[inbox-learning] no se pudo registrar:", error?.message));
  }
  if (outbound.replyToId) {
    const inbound = await prisma.message.findUnique({ where: { id: outbound.replyToId }, select: { meta: true } });
    if (inbound) {
      await prisma.message.update({
        where: { id: outbound.replyToId },
        data: { meta: { ...((inbound.meta ?? {}) as Record<string, unknown>), autoReplyStatus: "replied" } },
      });
    }
  }
}

// Para envíos manuales: si ya toca, se envía en la misma petición (el usuario
// ve el resultado al momento); si no, queda programado y lo envía el worker.
export async function processIfDue(outbound: OutboundMessage, maxWaitMs = 9_000) {
  const deadline = Date.now() + maxWaitMs;
  let current = outbound;
  for (let i = 0; i < 3 && current.status === "queued"; i++) {
    const wait = current.scheduledAt.getTime() - Date.now();
    if (Date.now() + Math.max(0, wait) > deadline) return current;
    if (wait > 0) await sleep(wait);
    current = (await processOutbound(current.id)) ?? current;
  }
  return current;
}

export function describeDecision(decision: SafetyDecision) {
  if (decision.kind === "block") return { status: "blocked", code: decision.code, message: decision.reason };
  if (decision.kind === "defer") {
    return { status: "scheduled", code: decision.code, message: decision.reason, scheduledAt: decision.retryAt };
  }
  return { status: "queued", code: "OK", message: decision.warnings.join(" "), scheduledAt: decision.notBefore };
}
