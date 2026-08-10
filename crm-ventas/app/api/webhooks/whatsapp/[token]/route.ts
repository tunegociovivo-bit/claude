import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findOrCreateContactByPhone, moveContactToStage } from "@/lib/contacts";
import { normalizePhone } from "@/lib/phone";
import { runSoniaWhatsappAgent, whatsappFallbackReply } from "@/lib/ai/sonia";
import { sendText } from "@/lib/waha";
import { findWorkspaceByToken, type WorkspaceSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function sendAutomaticReply(opts: {
  workspaceId: string;
  settings: WorkspaceSettings;
  phone: string;
  chatId: string;
  contactId: string;
  firstContact: boolean;
}) {
  let reply: string;
  try {
    reply = (await runSoniaWhatsappAgent({
      workspaceId: opts.workspaceId,
      settings: opts.settings,
      phone: opts.phone,
    })) ?? "";
  } catch (err: any) {
    console.error("[sonia-whatsapp] IA no disponible, usando respuesta segura:", err?.message);
    reply = whatsappFallbackReply(opts.settings, opts.firstContact);
  }
  if (!reply?.trim()) reply = whatsappFallbackReply(opts.settings, opts.firstContact);
  const sent = await sendText({ workspaceId: opts.workspaceId, to: opts.chatId, text: reply });
  await prisma.message.create({
    data: {
      workspaceId: opts.workspaceId,
      contactId: opts.contactId,
      phone: opts.phone,
      direction: "out",
      body: reply,
      externalId: sent.messageId,
      meta: { sonia: true },
    },
  });
}

// ---------------------------------------------------------------------------
// Webhook de WAHA (WhatsApp). En WAHA se configura:
//   URL:     https://<crm>/api/webhooks/whatsapp/<token>
//   Eventos: message, message.any, message.ack
//
// Patrones heredados (probados en producción en Hub.Negociovivo):
//  - Un ack se identifica por el NOMBRE del evento, nunca por la presencia del
//    campo `ack` (los mensajes normales también lo traen).
//  - `message.any` para mensajes que no son nuestros se ignora (duplicado de
//    `message`).
//  - Con el sistema LID el `from` puede ser "...@lid": se usa tal cual como
//    identificador del hilo y como chatId de respuesta.
// ---------------------------------------------------------------------------

function extractBody(payload: any): string {
  return (
    payload?.body ??
    payload?._data?.body ??
    payload?.message?.conversation ??
    payload?.message?.extendedTextMessage?.text ??
    payload?.message?.imageMessage?.caption ??
    ""
  )
    .toString()
    .trim();
}

function extractMessageId(payload: any): string {
  return (
    payload?.id?._serialized ??
    payload?.id?.id ??
    payload?.key?.id ??
    payload?.id ??
    ""
  ).toString();
}

function extractAlternatePhone(payload: any, countryCode: string): string | null {
  const candidates = [
    payload?._data?.Info?.SenderAlt,
    payload?._data?.Info?.RemoteJidAlt,
    payload?._data?.senderAlt,
    payload?.senderAlt,
    payload?.remoteJidAlt,
  ];
  for (const candidate of candidates) {
    const raw = String(candidate ?? "");
    if (!raw || raw.includes("@lid")) continue;
    const normalized = normalizePhone(
      raw.replace(/@(c\.us|s\.whatsapp\.net)$/, ""),
      countryCode
    );
    if (normalized) return normalized;
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const ws = await findWorkspaceByToken("whatsapp", params.token);
  if (!ws) return NextResponse.json({ error: "Token no válido" }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON no válido" }, { status: 400 });
  }

  const event: string = body?.event ?? "";
  const payload = body?.payload ?? body?.data ?? {};

  // Acks de entrega/lectura: nada que hacer en v1 (los aceptamos para que WAHA
  // no reintente). Identificados por el nombre del evento.
  if (event === "message.ack") {
    return NextResponse.json({ ok: true });
  }

  if (event !== "message" && event !== "message.any") {
    return NextResponse.json({ ok: true, ignored: event });
  }

  const fromMe: boolean = Boolean(payload?.fromMe ?? payload?._data?.fromMe);

  // "message.any" solo interesa para capturar lo que escribimos desde el móvil.
  if (event === "message.any" && !fromMe) {
    return NextResponse.json({ ok: true });
  }

  const rawFrom: string = String(payload?.from ?? payload?.chatId ?? "");
  const rawTo: string = String(payload?.to ?? "");
  const text = extractBody(payload);
  const externalId = extractMessageId(payload);
  if (!text) return NextResponse.json({ ok: true, empty: true });

  // Hilo: para entrantes es `from`; para salientes desde el móvil es `to`.
  const threadRaw = fromMe ? rawTo : rawFrom;
  if (!threadRaw || threadRaw.endsWith("@g.us")) {
    // Grupos fuera del alcance del CRM
    return NextResponse.json({ ok: true });
  }
  const threadPhone = threadRaw.includes("@lid")
    ? threadRaw
    : normalizePhone(threadRaw.replace(/@c\.us$/, ""), ws.settings.whatsapp.countryCode);
  if (!threadPhone) return NextResponse.json({ ok: true });
  const contactPhone = threadRaw.includes("@lid")
    ? extractAlternatePhone(payload, ws.settings.whatsapp.countryCode) ?? threadPhone
    : threadPhone;

  // Deduplicación por id externo (WAHA puede reenviar el mismo evento)
  if (externalId) {
    const dupe = await prisma.message.findFirst({
      where: { workspaceId: ws.id, externalId },
      select: { id: true, direction: true, phone: true, contactId: true, meta: true },
    });
    if (dupe) {
      const meta = (dupe.meta ?? {}) as Record<string, unknown>;
      if (!fromMe && ws.settings.whatsapp.autoReplyEnabled && dupe.direction === "in" && dupe.contactId && meta.autoReplyStatus === "pending") {
        try {
          await sendAutomaticReply({ workspaceId: ws.id, settings: ws.settings, phone: dupe.phone, chatId: threadRaw, contactId: dupe.contactId, firstContact: false });
          await prisma.message.update({ where: { id: dupe.id }, data: { meta: { ...meta, autoReplyStatus: "replied" } } });
          return NextResponse.json({ ok: true, duplicate: true, replied: true });
        } catch (err: any) {
          console.error("[sonia-whatsapp] reintento fallido:", err?.message);
          return NextResponse.json({ error: "No se pudo enviar la respuesta; reintentar" }, { status: 503, headers: { "Retry-After": "3" } });
        }
      }
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  // Mensaje que hemos enviado nosotros desde el teléfono → registrar y salir
  if (fromMe) {
    const previous = await prisma.message.findFirst({
      where: { workspaceId: ws.id, phone: threadPhone, contactId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { contactId: true },
    });
    await prisma.message.create({
      data: {
        workspaceId: ws.id,
        contactId: previous?.contactId,
        phone: threadPhone,
        direction: "out",
        body: text,
        externalId: externalId || null,
        meta: { fromPhone: true },
      },
    });
    return NextResponse.json({ ok: true, recorded: "out" });
  }

  // ---- Mensaje entrante de un cliente ----
  const pushName: string | undefined =
    payload?._data?.notifyName ?? payload?.pushName ?? undefined;

  const previousThreadMessage = await prisma.message.findFirst({
    where: { workspaceId: ws.id, phone: threadPhone, contactId: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { contact: true },
  });
  let contact = previousThreadMessage?.contact ?? null;
  if (contact) {
    const shouldUpdatePhone =
      contactPhone !== threadPhone && (!contact.phone || contact.phone === threadPhone);
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
    contact = await findOrCreateContactByPhone({
      workspaceId: ws.id,
      phone: contactPhone,
      name: pushName,
      source: "whatsapp",
    });
  }
  // Si estaba en "nuevos", pasa a "En conversación"
  if (contact.stage === "nuevos") {
    await moveContactToStage(contact.id, "conversacion");
  }

  const incomingMessage = await prisma.message.create({
    data: {
      workspaceId: ws.id,
      contactId: contact.id,
      phone: threadPhone,
      direction: "in",
      body: text,
      externalId: externalId || null,
      meta: { pushName: pushName ?? null, from: rawFrom, autoReplyStatus: ws.settings.whatsapp.autoReplyEnabled ? "processing" : "disabled" },
    },
  });

  // Respuesta automática de SONIA
  if (ws.settings.whatsapp.autoReplyEnabled) {
    try {
      await sendAutomaticReply({
        workspaceId: ws.id,
        settings: ws.settings,
        phone: threadPhone,
        chatId: threadRaw,
        contactId: contact.id,
        firstContact: !previousThreadMessage,
      });
      await prisma.message.update({
        where: { id: incomingMessage.id },
        data: { meta: { pushName: pushName ?? null, from: rawFrom, autoReplyStatus: "replied" } },
      });
    } catch (err: any) {
      // Un 503 hace que WAHA reintente; la deduplicación retomará solo el envío pendiente.
      await prisma.message.update({
        where: { id: incomingMessage.id },
        data: { meta: { pushName: pushName ?? null, from: rawFrom, autoReplyStatus: "pending" } },
      });
      console.error("[sonia-whatsapp] no se pudo enviar; solicitando reintento:", err?.message);
      return NextResponse.json(
        { error: "No se pudo enviar la respuesta; reintentar" },
        { status: 503, headers: { "Retry-After": "3" } }
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const ws = await findWorkspaceByToken("whatsapp", params.token);
  if (!ws) return NextResponse.json({ error: "Token no válido" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    uso: "Configura esta URL como webhook en WAHA con eventos message, message.any y message.ack",
  });
}
