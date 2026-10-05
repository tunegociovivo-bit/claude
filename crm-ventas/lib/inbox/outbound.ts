import "server-only";
import type { OutboundMessage, WhatsappLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendSeen, sendText, setTyping } from "@/lib/waha";
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

export class OutboundError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "ERROR") {
    super(message);
  }
}

async function safetyCounters(opts: {
  line: WhatsappLine;
  conversationId: string;
  workspaceId: string;
  phone: string;
  lastInboundAt: Date | null;
  fingerprint: string;
  now: Date;
}): Promise<SafetyCounters> {
  const hourAgo = new Date(opts.now.getTime() - 3600_000);
  const dayStart = madridDayStart(opts.now);
  const sentWhere = { lineId: opts.line.id, status: "sent" };
  const [sentLastHour, oldest, sentToday, newChatsToday, identical, outboundMessages, queuedHere] = await Promise.all([
    prisma.outboundMessage.count({ where: { ...sentWhere, sentAt: { gte: hourAgo } } }),
    prisma.outboundMessage.findFirst({
      where: { ...sentWhere, sentAt: { gte: hourAgo } },
      orderBy: { sentAt: "asc" },
      select: { sentAt: true },
    }),
    prisma.outboundMessage.count({ where: { ...sentWhere, sentAt: { gte: dayStart } } }),
    prisma.outboundMessage.count({ where: { ...sentWhere, cold: true, sentAt: { gte: dayStart } } }),
    prisma.outboundMessage.findMany({
      where: {
        lineId: opts.line.id,
        fingerprint: opts.fingerprint,
        createdAt: { gte: hourAgo },
        status: { in: ["queued", "sending", "sent"] },
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
    prisma.outboundMessage.count({
      where: { conversationId: opts.conversationId, status: { in: ["queued", "sending"] } },
    }),
  ]);
  return {
    sentLastHour,
    oldestInLastHour: oldest?.sentAt ?? null,
    sentToday,
    newChatsToday,
    identicalOtherChats: identical.length,
    outboundSinceLastInbound: outboundMessages + queuedHere,
  };
}

// Último envío hecho o ya programado en la línea (para encadenar el ritmo).
async function lastScheduledOnLine(line: WhatsappLine): Promise<Date | null> {
  const pending = await prisma.outboundMessage.findFirst({
    where: { lineId: line.id, status: { in: ["queued", "sending"] } },
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

  let line = conversation.lineId
    ? await prisma.whatsappLine.findFirst({ where: { id: conversation.lineId, workspaceId: opts.workspaceId } })
    : await ensurePrimaryLine(opts.workspaceId);
  if (!line && conversation.lineId) {
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

// Envía un mensaje de la cola con lectura + «escribiendo…» y registra el resultado.
export async function processOutbound(id: string): Promise<OutboundMessage | null> {
  const now = new Date();
  const claimed = await prisma.outboundMessage.updateMany({
    where: { id, status: "queued", scheduledAt: { lte: now } },
    data: { status: "sending", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return prisma.outboundMessage.findUnique({ where: { id } });
  const outbound = await prisma.outboundMessage.findUniqueOrThrow({ where: { id } });

  const requeue = (at: Date, reason: string, countAttempt = false) =>
    prisma.outboundMessage.update({
      where: { id },
      data: {
        status: "queued",
        scheduledAt: at,
        lastError: reason,
        ...(countAttempt ? {} : { attempts: { decrement: 1 } }),
      },
    });

  const [conversation, lineRow] = await Promise.all([
    prisma.conversation.findUnique({ where: { id: outbound.conversationId } }),
    prisma.whatsappLine.findUnique({ where: { id: outbound.lineId } }),
  ]);
  if (!conversation || !lineRow) {
    return prisma.outboundMessage.update({
      where: { id },
      data: { status: "failed", lastError: "La conversación o el número ya no existen" },
    });
  }
  if (conversation.optedOut) {
    return prisma.outboundMessage.update({
      where: { id },
      data: { status: "canceled", lastError: "OPTED_OUT: el cliente pidió la baja" },
    });
  }
  if (!lineRow.active) {
    return prisma.outboundMessage.update({
      where: { id },
      data: { status: "blocked", lastError: "LINE_INACTIVE: número desactivado" },
    });
  }
  if (lineRow.pausedUntil && lineRow.pausedUntil.getTime() > now.getTime()) {
    return requeue(lineRow.pausedUntil, `LINE_PAUSED: ${lineRow.pauseReason ?? "pausa de seguridad"}`);
  }
  const line = await refreshLineStatus(lineRow, 30_000);
  if (line.lastStatus !== "WORKING") {
    const waitedMs = now.getTime() - outbound.createdAt.getTime();
    if (waitedMs > 6 * 3600_000) {
      return prisma.outboundMessage.update({
        where: { id },
        data: { status: "failed", lastError: `SESSION_DOWN: WhatsApp sin conexión (${line.lastStatus})` },
      });
    }
    return requeue(new Date(now.getTime() + 2 * 60_000), `SESSION_DOWN: WhatsApp sin conexión (${line.lastStatus})`);
  }

  try {
    // Simulación humana: marcar leído, «escribiendo…» y pausa proporcional.
    await sendSeen({ workspaceId: line.workspaceId, session: line.sessionName, chatId: outbound.chatId });
    await setTyping({ workspaceId: line.workspaceId, session: line.sessionName, chatId: outbound.chatId, typing: true });
    await sleep(typingDelayMs(outbound.body, outbound.origin === "auto" ? "auto" : "manual"));
    await setTyping({ workspaceId: line.workspaceId, session: line.sessionName, chatId: outbound.chatId, typing: false });

    const sent = await sendText({
      workspaceId: line.workspaceId,
      to: outbound.chatId,
      text: outbound.body,
      session: line.sessionName,
    });
    const sentAt = new Date();
    const message = await prisma.message.create({
      data: {
        workspaceId: outbound.workspaceId,
        contactId: conversation.contactId,
        phone: outbound.phone,
        direction: "out",
        body: outbound.body,
        externalId: sent.messageId,
        lineId: line.id,
        ack: 1,
        meta: {
          outboundId: outbound.id,
          ...(outbound.origin === "auto" ? { sonia: true } : { manual: true, userId: outbound.userId }),
        },
      },
    });
    const done = await prisma.outboundMessage.update({
      where: { id },
      data: { status: "sent", sentAt, messageId: message.id, lastError: null },
    });
    await prisma.whatsappLine.update({
      where: { id: line.id },
      data: { lastSentAt: sentAt, consecutiveFailures: 0 },
    });
    await touchConversationOnOutbound({
      workspaceId: outbound.workspaceId,
      phone: outbound.phone,
      lineId: line.id,
      body: outbound.body,
      at: sentAt,
    });
    if (outbound.origin === "manual") {
      // Una persona respondió: el borrador queda resuelto y la IA automática
      // de este chat se pausa 2 h para no pisar a la persona.
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
    return done;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failures = line.consecutiveFailures + 1;
    await prisma.whatsappLine.update({ where: { id: line.id }, data: { consecutiveFailures: failures, lastStatusAt: null } });
    if (isSevereSendError(reason)) {
      await pauseLine(line, 12 * 60, "WhatsApp rechazó el envío (sesión cerrada o número restringido). Revisa el móvil.");
    } else if (failures >= 3) {
      await pauseLine(line, 30, `${failures} envíos seguidos fallidos`);
    }
    if (outbound.attempts >= MAX_ATTEMPTS) {
      return prisma.outboundMessage.update({ where: { id }, data: { status: "failed", lastError: reason.slice(0, 500) } });
    }
    return requeue(new Date(Date.now() + 60_000 * outbound.attempts), reason.slice(0, 500), true);
  }
}

// Para envíos manuales: si ya toca, se envía en la misma petición (el usuario
// ve el resultado al momento); si no, queda programado y lo envía el worker.
export async function processIfDue(outbound: OutboundMessage, maxWaitMs = 9_000) {
  if (outbound.status !== "queued") return outbound;
  const wait = outbound.scheduledAt.getTime() - Date.now();
  if (wait > maxWaitMs) return outbound;
  if (wait > 0) await sleep(wait);
  return (await processOutbound(outbound.id)) ?? outbound;
}

export function describeDecision(decision: SafetyDecision) {
  if (decision.kind === "block") return { status: "blocked", code: decision.code, message: decision.reason };
  if (decision.kind === "defer") {
    return { status: "scheduled", code: decision.code, message: decision.reason, scheduledAt: decision.retryAt };
  }
  return { status: "queued", code: "OK", message: decision.warnings.join(" "), scheduledAt: decision.notBefore };
}
