import "server-only";
import { prisma } from "@/lib/prisma";
import { findOrCreateContactByPhone, moveContactToStage } from "@/lib/contacts";
import { normalizePhone } from "@/lib/phone";
import type { WorkspaceSettings } from "@/lib/settings";
import { lineForSession } from "@/lib/inbox/lines";
import { touchConversationOnOutbound, upsertConversationOnInbound } from "@/lib/inbox/conversations";
import { recordHumanReply } from "@/lib/inbox/learning";
import { scheduleConversationAi } from "@/lib/inbox/ai";
import { cancelQueuedAutoReplies, cancelQueuedLeadWelcome } from "@/lib/inbox/outbound";
import { isOptOutMessage } from "@/lib/inbox/text";
import { extractMedia, extractSpecialText, mediaBody } from "@/lib/inbox/media-core";
import { attachStoredMedia, pendingMedia, storeWhatsappMedia } from "@/lib/inbox/media";
import { getLeadsState } from "@/lib/leads/settings";
import { isForwardTargetPhone } from "@/lib/leads/config";
import type { ExtractedMedia } from "@/lib/inbox/media-core";
import {
  extractAck,
  extractAlternatePhone,
  extractBody,
  extractMessageId,
  extractPushName,
  extractSession,
  isApiSent,
} from "@/lib/inbox/webhook-payload";

type Ws = { id: string; settings: WorkspaceSettings };
export type IngestResult = Record<string, unknown> & { ok: boolean; kick?: boolean };

// ---------------------------------------------------------------------------
// Evento de WAHA → bandeja unificada. Patrones heredados del Hub:
//  - Un ack se identifica por el NOMBRE del evento, no por el campo `ack`.
//  - `message.any` de mensajes ajenos se ignora (duplicado de `message`).
//  - Con LID el `from` puede ser "...@lid": se usa tal cual como hilo y chatId.
// La respuesta (IA o humana) ya no se envía aquí: la gestiona la cola de
// salida con sus reglas anti-baneo, así el webhook contesta al instante.
// ---------------------------------------------------------------------------
export async function ingestWhatsappEvent(ws: Ws, body: any): Promise<IngestResult> {
  const event: string = body?.event ?? "";
  const payload = body?.payload ?? body?.data ?? {};
  const countryCode = ws.settings.whatsapp.countryCode;

  if (event === "message.ack") {
    const externalId = extractMessageId(payload);
    const ack = extractAck(payload);
    if (externalId && ack !== null) {
      const message = await prisma.message.findFirst({
        where: { workspaceId: ws.id, externalId },
        select: { id: true, ack: true },
      });
      if (message && (ack === -1 || (message.ack ?? 0) < ack)) {
        await prisma.message.update({ where: { id: message.id }, data: { ack } });
      }
    }
    return { ok: true };
  }
  if (event !== "message" && event !== "message.any") return { ok: true, ignored: event };

  const fromMe = Boolean(payload?.fromMe ?? payload?._data?.fromMe);
  if (event === "message.any" && !fromMe) return { ok: true };

  const line = await lineForSession(ws.id, extractSession(body));
  if (!line) return { ok: true, ignored: "unknown-session" };

  const rawFrom = String(payload?.from ?? payload?.chatId ?? "");
  const rawTo = String(payload?.to ?? "");
  const externalId = extractMessageId(payload);
  // Fotos, audios, vídeos y documentos se guardan (antes se ignoraban). La
  // ubicación y las tarjetas de contacto se guardan como texto.
  const media = extractMedia(payload);
  const special = media ? "" : extractSpecialText(payload);
  let text = special || extractBody(payload);
  if (media) {
    const plainBody = typeof payload?.body === "string" && !looksLikeBase64(payload.body) ? payload.body.trim() : "";
    media.caption = (media.caption || plainBody).slice(0, 4000);
    text = mediaBody(media);
  }
  if (!text) return { ok: true, empty: true };

  const threadRaw = fromMe ? rawTo : rawFrom;
  if (!threadRaw || threadRaw.endsWith("@g.us") || threadRaw.endsWith("@newsletter") || threadRaw === "status@broadcast") {
    return { ok: true };
  }
  const threadPhone = threadRaw.includes("@lid")
    ? threadRaw
    : normalizePhone(threadRaw.replace(/@(c\.us|s\.whatsapp\.net)$/, ""), countryCode);
  if (!threadPhone) return { ok: true };
  // No registrar conversaciones entre números del propio negocio.
  const ownNumbers = await prisma.whatsappLine.findMany({
    where: { workspaceId: ws.id, phone: { not: null } },
    select: { phone: true },
  });
  if (ownNumbers.some((l) => l.phone && l.phone === threadPhone)) return { ok: true, ignored: "own-number" };
  // Los destinos de «ENVIAR A» (equipo, clínica asociada…) no son clientes: lo
  // que se les reenvía no abre chats en la bandeja ni activa a la IA.
  const leads = await getLeadsState(ws.id);
  if (leads.forwardTargets.length && isForwardTargetPhone(leads.forwardTargets, threadPhone)) {
    return { ok: true, ignored: "forward-target" };
  }

  const contactPhone = threadRaw.includes("@lid") ? extractAlternatePhone(payload, countryCode) ?? threadPhone : threadPhone;

  if (externalId) {
    const dupe = await prisma.message.findFirst({
      where: { workspaceId: ws.id, externalId },
      select: { id: true, direction: true, body: true, createdAt: true, contactId: true, meta: true },
    });
    if (dupe) {
      // El primer intento se cortó mientras descargaba el archivo: se reintenta.
      if (media && (dupe.meta as any)?.media?.pending) {
        await downloadInto(ws.id, line, dupe.id, media);
      }
      // Reintento de WAHA tras un fallo a medias: completar lo que faltase
      // (conversación y programación de la IA) sin duplicar el mensaje.
      if (dupe.direction === "in" && !fromMe) {
        const conv = await prisma.conversation.findUnique({
          where: { workspaceId_phone: { workspaceId: ws.id, phone: threadPhone } },
          select: { id: true, lastInboundAt: true, lastInboundId: true, aiStatus: true, aiDraftForId: true, optedOut: true },
        });
        if (
          conv &&
          conv.lastInboundId === dupe.id &&
          conv.aiStatus === "idle" &&
          conv.aiDraftForId !== dupe.id &&
          line.aiMode !== "off" &&
          !isOptOutMessage(dupe.body)
        ) {
          // Se guardó la conversación pero falló al programar la IA: se programa ahora.
          const answered = await prisma.outboundMessage.count({
            where: { conversationId: conv.id, replyToId: dupe.id, status: { not: "canceled" } },
          });
          if (!answered) {
            await scheduleConversationAi(conv.id, line.aiMode === "auto" && !conv.optedOut ? "auto" : "suggest");
            return { ok: true, duplicate: true, kick: true };
          }
        }
        if (!conv?.lastInboundAt || conv.lastInboundAt.getTime() < dupe.createdAt.getTime()) {
          return finalizeInbound(ws.id, line, {
            messageId: dupe.id,
            body: dupe.body,
            at: dupe.createdAt,
            phone: threadPhone,
            chatId: threadRaw,
            contactId: dupe.contactId,
          });
        }
      }
      return { ok: true, duplicate: true };
    }
  }

  const now = new Date();

  // ---- Mensaje enviado desde el propio WhatsApp (móvil u otra app) ----
  if (fromMe) {
    // Eco de un envío del CRM que aún no se ha registrado (carrera con sendText).
    const ownEcho = await prisma.outboundMessage.findFirst({
      where: {
        workspaceId: ws.id,
        phone: threadPhone,
        body: text,
        OR: [{ status: "sending" }, { status: "sent", sentAt: { gte: new Date(now.getTime() - 3 * 60_000) } }],
      },
      select: { id: true },
    });
    if (ownEcho) return { ok: true, duplicate: true };
    const previous = await prisma.message.findFirst({
      where: { workspaceId: ws.id, phone: threadPhone, contactId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { contactId: true },
    });
    const message = await prisma.message.create({
      data: {
        workspaceId: ws.id,
        contactId: previous?.contactId,
        phone: threadPhone,
        direction: "out",
        body: text,
        externalId: externalId || null,
        lineId: line.id,
        meta: { fromPhone: true, apiSent: isApiSent(payload), ...(media ? { media: pendingMedia(media) } : {}) },
      },
    });
    // No cambia el número del chat: las respuestas siguen saliendo por el
    // número al que escribió el cliente.
    await touchConversationOnOutbound({
      workspaceId: ws.id,
      phone: threadPhone,
      chatId: threadRaw,
      lineId: line.id,
      contactId: previous?.contactId ?? null,
      body: text,
      at: message.createdAt,
      keepLine: true,
    });
    if (!isApiSent(payload)) {
      // Respuesta escrita a mano en el móvil: la IA también aprende de ella y
      // se aparta de este chat un par de horas (los archivos no enseñan estilo).
      const conversation = await prisma.conversation.findUnique({
        where: { workspaceId_phone: { workspaceId: ws.id, phone: threadPhone } },
        select: { id: true, aiDraft: true },
      });
      if (conversation) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { humanUntil: new Date(now.getTime() + 2 * 3600_000), aiDraft: null, aiDraftForId: null, aiStatus: "idle" },
        });
        await cancelQueuedAutoReplies({ conversationId: conversation.id }, "Respondido a mano desde el móvil");
      }
      if (!media && !special) {
        await recordHumanReply({
          workspaceId: ws.id,
          lineId: line.id,
          phone: threadPhone,
          finalText: text,
          aiDraft: conversation?.aiDraft ?? null,
          source: "phone",
          at: message.createdAt,
        }).catch(() => undefined);
      }
    }
    if (media) await downloadInto(ws.id, line, message.id, media);
    return { ok: true, recorded: "out" };
  }

  // ---- Mensaje entrante de un cliente ----
  const pushName = extractPushName(payload);
  const previousThreadMessage = await prisma.message.findFirst({
    where: { workspaceId: ws.id, phone: threadPhone, contactId: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { contact: true },
  });
  let contact = previousThreadMessage?.contact ?? null;
  if (contact) {
    const shouldUpdatePhone = contactPhone !== threadPhone && (!contact.phone || contact.phone === threadPhone);
    const shouldUpdateName = Boolean(
      pushName && (!contact.name || contact.name === contact.phone || contact.name.includes("@lid"))
    );
    if (shouldUpdatePhone || shouldUpdateName) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: {
          ...(shouldUpdatePhone ? { phone: contactPhone } : {}),
          ...(shouldUpdateName ? { name: pushName!.trim() } : {}),
        },
      });
    }
  } else {
    contact = await findOrCreateContactByPhone({ workspaceId: ws.id, phone: contactPhone, name: pushName, source: "whatsapp" });
  }
  if (contact.stage === "nuevos") await moveContactToStage(contact.id, "conversacion");

  // La baja solo se detecta en texto escrito (nunca en el nombre de un archivo).
  const optOut = media ? isOptOutMessage(media.caption) : isOptOutMessage(text);
  const message = await prisma.message.create({
    data: {
      workspaceId: ws.id,
      contactId: contact.id,
      phone: threadPhone,
      direction: "in",
      body: text,
      externalId: externalId || null,
      lineId: line.id,
      meta: {
        pushName: pushName ?? null,
        from: rawFrom,
        session: line.sessionName,
        autoReplyStatus: optOut ? "opted-out" : line.aiMode === "auto" ? "processing" : "disabled",
        ...(media ? { media: pendingMedia(media) } : {}),
      },
    },
  });
  // Primero queda guardado el mensaje (y la conversación): si WAHA reintenta
  // mientras se descarga el archivo, el reintento lo ve como duplicado.
  const result = await finalizeInbound(ws.id, line, {
    messageId: message.id,
    body: text,
    at: message.createdAt,
    phone: threadPhone,
    chatId: threadRaw,
    contactId: contact.id,
    optOut,
    // Un sticker no pide respuesta: se guarda sin despertar a la IA.
    skipAi: media?.kind === "sticker",
  });
  if (media) await downloadInto(ws.id, line, message.id, media);
  return result;
}

async function downloadInto(workspaceId: string, line: { id: string; sessionName: string }, messageId: string, media: ExtractedMedia) {
  const stored = await storeWhatsappMedia({ workspaceId, lineId: line.id, session: line.sessionName, media });
  await attachStoredMedia(messageId, stored).catch((error) =>
    console.error("[whatsapp-media] no se pudo adjuntar el archivo:", error?.message)
  );
}

// WEBJS deja una miniatura en base64 en el cuerpo de algunos mensajes con archivo.
function looksLikeBase64(value: string): boolean {
  const v = value.trim();
  return v.length > 200 && /^[A-Za-z0-9+/=]+$/.test(v);
}

// Pasos posteriores a guardar un entrante (idempotentes ante reintentos).
async function finalizeInbound(
  workspaceId: string,
  line: { id: string; aiMode: string },
  m: {
    messageId: string;
    body: string;
    at: Date;
    phone: string;
    chatId: string;
    contactId: string | null;
    skipAi?: boolean;
    optOut?: boolean;
  }
): Promise<IngestResult> {
  const conversation = await upsertConversationOnInbound({
    workspaceId,
    phone: m.phone,
    chatId: m.chatId,
    lineId: line.id,
    contactId: m.contactId,
    messageId: m.messageId,
    body: m.body,
    at: m.at,
    passive: m.skipAi,
  });
  // Sticker: no cambia nada de lo que la IA estaba haciendo.
  if (m.skipAi) return { ok: true };

  // Respuesta automática aún no enviada a un mensaje anterior: se cancela y se
  // vuelve a generar con el contexto completo (una sola respuesta, no dos).
  await cancelQueuedAutoReplies({ conversationId: conversation.id }, "Sustituida: el cliente escribió de nuevo");
  // Si el lead escribe antes de que salga su primer mensaje automático, ya no hace falta.
  await cancelQueuedLeadWelcome(conversation.id, "El lead ya ha escrito: no hace falta el primer mensaje");

  if (m.optOut ?? isOptOutMessage(m.body)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { optedOut: true, optedOutAt: new Date(), aiStatus: "idle", aiDraft: null, aiDueAt: null },
    });
    await prisma.outboundMessage.updateMany({
      where: { conversationId: conversation.id, status: "queued" },
      data: { status: "canceled", lastError: "OPTED_OUT: el cliente pidió la baja" },
    });
    return { ok: true, optedOut: true };
  }
  // Un chat dado de baja sigue de baja aunque el cliente escriba de nuevo: la
  // IA nunca le envía nada, pero deja una propuesta para que decida una persona.
  if (line.aiMode === "off") return { ok: true };
  await scheduleConversationAi(conversation.id, line.aiMode === "auto" && !conversation.optedOut ? "auto" : "suggest");
  return { ok: true, kick: true };
}
