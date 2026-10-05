import "server-only";
import { prisma } from "@/lib/prisma";
import { findOrCreateContactByPhone, moveContactToStage } from "@/lib/contacts";
import { normalizePhone } from "@/lib/phone";
import type { WorkspaceSettings } from "@/lib/settings";
import { lineForSession } from "@/lib/inbox/lines";
import { touchConversationOnOutbound, upsertConversationOnInbound } from "@/lib/inbox/conversations";
import { recordHumanReply } from "@/lib/inbox/learning";
import { scheduleConversationAi } from "@/lib/inbox/ai";
import { isOptOutMessage } from "@/lib/inbox/text";
import {
  extractAck,
  extractAlternatePhone,
  extractBody,
  extractMessageId,
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
  const text = extractBody(payload);
  const externalId = extractMessageId(payload);
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

  const contactPhone = threadRaw.includes("@lid") ? extractAlternatePhone(payload, countryCode) ?? threadPhone : threadPhone;

  if (externalId) {
    const dupe = await prisma.message.findFirst({ where: { workspaceId: ws.id, externalId }, select: { id: true } });
    if (dupe) return { ok: true, duplicate: true };
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
        status: { in: ["sending", "sent"] },
        createdAt: { gte: new Date(now.getTime() - 5 * 60_000) },
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
        meta: { fromPhone: true, apiSent: isApiSent(payload) },
      },
    });
    await touchConversationOnOutbound({
      workspaceId: ws.id,
      phone: threadPhone,
      chatId: threadRaw,
      lineId: line.id,
      contactId: previous?.contactId ?? null,
      body: text,
      at: message.createdAt,
    });
    if (!isApiSent(payload)) {
      // Respuesta escrita a mano en el móvil: la IA también aprende de ella y
      // se aparta de este chat un par de horas.
      const conversation = await prisma.conversation.findUnique({
        where: { workspaceId_phone: { workspaceId: ws.id, phone: threadPhone } },
        select: { id: true, aiDraft: true },
      });
      if (conversation) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { humanUntil: new Date(now.getTime() + 2 * 3600_000), aiDraft: null, aiDraftForId: null, aiStatus: "idle" },
        });
      }
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
    return { ok: true, recorded: "out" };
  }

  // ---- Mensaje entrante de un cliente ----
  const pushName: string | undefined = payload?._data?.notifyName ?? payload?.pushName ?? undefined;
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

  const optOut = isOptOutMessage(text);
  const aiOn = line.aiMode !== "off" && !optOut;
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
        autoReplyStatus: aiOn && line.aiMode === "auto" ? "processing" : optOut ? "opted-out" : "disabled",
      },
    },
  });
  const conversation = await upsertConversationOnInbound({
    workspaceId: ws.id,
    phone: threadPhone,
    chatId: threadRaw,
    lineId: line.id,
    contactId: contact.id,
    messageId: message.id,
    body: text,
    at: message.createdAt,
  });

  // Respuesta automática aún no enviada a un mensaje anterior: se cancela y se
  // vuelve a generar con el contexto completo (una sola respuesta, no dos).
  await prisma.outboundMessage.updateMany({
    where: { conversationId: conversation.id, origin: "auto", status: "queued" },
    data: { status: "canceled", lastError: "Sustituida: el cliente escribió de nuevo" },
  });

  if (optOut) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { optedOut: true, optedOutAt: now, aiStatus: "idle", aiDraft: null, aiDueAt: null },
    });
    await prisma.outboundMessage.updateMany({
      where: { conversationId: conversation.id, status: "queued" },
      data: { status: "canceled", lastError: "OPTED_OUT: el cliente pidió la baja" },
    });
    return { ok: true, optedOut: true };
  }
  if (conversation.optedOut) {
    // Volvió a escribir por iniciativa propia: se le puede responder otra vez.
    await prisma.conversation.update({ where: { id: conversation.id }, data: { optedOut: false, optedOutAt: null } });
  }
  if (aiOn) {
    await scheduleConversationAi(conversation.id, line.aiMode === "auto" ? "auto" : "suggest");
    return { ok: true, kick: true };
  }
  return { ok: true };
}
