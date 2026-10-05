import "server-only";
import { prisma } from "@/lib/prisma";
import { getWorkspaceSettings } from "@/lib/settings";
import { runSoniaWhatsappAgent, whatsappFallbackReply } from "@/lib/ai/sonia";
import { learningPromptFor } from "@/lib/inbox/learning";
import { ensurePrimaryLine } from "@/lib/inbox/lines";
import { enqueueOutbound } from "@/lib/inbox/outbound";
import { readingDelayMs } from "@/lib/inbox/safety";
import { notifyWorkspaceUrgentAlert } from "@/lib/urgent-alert-delivery";

// Espera tras el último mensaje del cliente antes de contestar: la gente
// escribe en varias burbujas («hola» / «quería cita» / «para mañana»).
export const AUTO_DEBOUNCE_MS = 9_000;
export const SUGGEST_DEBOUNCE_MS = 3_000;

export async function scheduleConversationAi(conversationId: string, mode: "auto" | "suggest") {
  const dueAt = new Date(Date.now() + (mode === "auto" ? AUTO_DEBOUNCE_MS : SUGGEST_DEBOUNCE_MS));
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { aiStatus: "pending", aiDueAt: dueAt, aiError: null },
  });
}

function lineContext(line: { label: string; instructions: string | null; mode: string } | null) {
  if (!line?.instructions?.trim()) return "";
  return `CONTEXTO DE ESTE NÚMERO DE WHATSAPP («${line.label}»):\n${line.instructions.trim()}`;
}

export async function buildDraft(opts: {
  workspaceId: string;
  phone: string;
  lineId: string | null;
  mode: "auto" | "suggest";
  onSideEffect?: (toolName: string) => void;
}): Promise<string | null> {
  const [settings, line, lastIn] = await Promise.all([
    getWorkspaceSettings(opts.workspaceId),
    opts.lineId ? prisma.whatsappLine.findUnique({ where: { id: opts.lineId } }) : Promise.resolve(null),
    prisma.message.findFirst({
      where: { workspaceId: opts.workspaceId, phone: opts.phone, direction: "in" },
      orderBy: { createdAt: "desc" },
      select: { body: true },
    }),
  ]);
  const learning = await learningPromptFor({
    workspaceId: opts.workspaceId,
    phone: opts.phone,
    lineId: opts.lineId,
    currentText: lastIn?.body ?? "",
  });
  return runSoniaWhatsappAgent({
    workspaceId: opts.workspaceId,
    settings,
    phone: opts.phone,
    mode: opts.mode,
    extraSystem: [lineContext(line), learning].filter(Boolean).join("\n\n"),
    onSideEffect: opts.onSideEffect,
  });
}

// Genera la respuesta de una conversación pendiente: la envía (modo auto) o la
// deja como propuesta para que una persona la revise (modo suggest).
export async function processConversationAi(conversationId: string) {
  const now = new Date();
  const claimed = await prisma.conversation.updateMany({
    where: { id: conversationId, aiStatus: "pending", aiDueAt: { lte: now } },
    data: { aiStatus: "generating" },
  });
  if (claimed.count === 0) return;
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  // Sin línea asignada (chats antiguos) se usa la principal; si la línea se
  // quitó de la bandeja, NO se responde desde otro número.
  const line = conversation.lineId
    ? await prisma.whatsappLine.findUnique({ where: { id: conversation.lineId } })
    : await ensurePrimaryLine(conversation.workspaceId);

  if (!line || line.aiMode === "off" || conversation.optedOut || !conversation.lastInboundId) {
    await prisma.conversation.update({ where: { id: conversationId }, data: { aiStatus: "idle" } });
    return;
  }
  const humanActive = conversation.humanUntil && conversation.humanUntil.getTime() > now.getTime();
  const canAutoSend =
    line.aiMode === "auto" &&
    !humanActive &&
    line.active &&
    !(line.pausedUntil && line.pausedUntil.getTime() > now.getTime());
  const mode: "auto" | "suggest" = canAutoSend ? "auto" : "suggest";
  const forId = conversation.lastInboundId;

  let text: string | null = null;
  let failure: string | null = null;
  let sideEffect = false;
  try {
    text = await buildDraft({
      workspaceId: conversation.workspaceId,
      phone: conversation.phone,
      lineId: line.id,
      mode,
      onSideEffect: () => {
        sideEffect = true;
      },
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    console.error("[inbox-ai] no se pudo generar la respuesta:", failure);
  }

  // Si el cliente escribió algo nuevo mientras pensábamos, se vuelve a generar
  // con todo el contexto (y no se envía una respuesta ya desfasada).
  const fresh = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { lastInboundId: true, aiStatus: true },
  });
  if (!fresh) return;
  const superseded = fresh.aiStatus !== "generating" || fresh.lastInboundId !== forId;
  if (superseded && !(mode === "auto" && sideEffect && text)) {
    if (fresh.aiStatus === "generating") {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { aiStatus: "pending", aiDueAt: new Date(Date.now() + 2_000) },
      });
    }
    return;
  }
  // Si la IA ya creó o canceló una cita, su confirmación se envía aunque el
  // cliente haya escrito algo más (y después se responde a lo nuevo).

  if (mode === "suggest") {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: text
        ? { aiStatus: "idle", aiDraft: text, aiDraftAt: new Date(), aiDraftForId: forId, aiError: null }
        : { aiStatus: "error", aiError: failure ? "La IA no está disponible ahora mismo" : "La IA no ha propuesto respuesta" },
    });
    return;
  }

  // Modo automático
  const settings = await getWorkspaceSettings(conversation.workspaceId);
  if (!text && !failure) {
    // Nada que decir (p. ej. el último mensaje ya era nuestro): no se envía relleno.
    await prisma.conversation.update({ where: { id: conversationId }, data: { aiStatus: "idle" } });
    return;
  }
  if (!text) {
    const previousOut = await prisma.message.count({
      where: { workspaceId: conversation.workspaceId, phone: conversation.phone, direction: "out" },
    });
    text = whatsappFallbackReply(settings, previousOut === 0);
    if (failure) {
      await notifyWorkspaceUrgentAlert(
        conversation.workspaceId,
        "CRM_MESSAGE_ERROR",
        "La IA no pudo generar la respuesta automática; se envió un mensaje de cortesía."
      ).catch(() => undefined);
    }
  }
  const inbound = await prisma.message.findUnique({ where: { id: forId }, select: { body: true, meta: true } });
  const { decision } = await enqueueOutbound({
    workspaceId: conversation.workspaceId,
    conversationId,
    body: text!,
    origin: "auto",
    replyToId: forId,
    critical: sideEffect,
    minDelayMs: readingDelayMs(inbound?.body ?? ""),
  });
  if (inbound) {
    await prisma.message.update({
      where: { id: forId },
      data: {
        meta: {
          ...((inbound.meta ?? {}) as Record<string, unknown>),
          autoReplyStatus: decision.kind === "block" ? "blocked" : "queued",
        },
      },
    });
  }
  if (superseded) {
    // Confirmación crítica enviada a la cola: ahora toca responder a lo nuevo.
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { aiStatus: "pending", aiDueAt: new Date(Date.now() + AUTO_DEBOUNCE_MS) },
    });
    return;
  }
  await prisma.conversation.update({
    where: { id: conversationId },
    data:
      decision.kind === "block"
        ? // Bloqueado por seguridad: se deja como propuesta para que decida una persona.
          { aiStatus: "idle", aiDraft: text, aiDraftAt: new Date(), aiDraftForId: forId, aiError: decision.reason }
        : { aiStatus: "idle", aiDraft: null, aiDraftForId: null, aiError: null },
  });
}

// Regenerar a petición del usuario (botón «Otra propuesta»). Siempre en modo propuesta.
export async function regenerateDraft(workspaceId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId } });
  if (!conversation) return null;
  const text = await buildDraft({ workspaceId, phone: conversation.phone, lineId: conversation.lineId, mode: "suggest" });
  return prisma.conversation.update({
    where: { id: conversationId },
    data: {
      aiDraft: text,
      aiDraftAt: new Date(),
      aiDraftForId: conversation.lastInboundId,
      aiStatus: "idle",
      aiError: text ? null : "La IA no ha propuesto respuesta",
    },
  });
}
