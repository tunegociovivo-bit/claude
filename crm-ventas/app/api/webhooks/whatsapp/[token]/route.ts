import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findOrCreateContactByPhone, moveContactToStage } from "@/lib/contacts";
import { normalizePhone } from "@/lib/phone";
import { runSoniaWhatsappAgent } from "@/lib/ai/sonia";
import { sendText } from "@/lib/waha";
import { findWorkspaceByToken } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  const phone = threadRaw.includes("@lid")
    ? threadRaw
    : normalizePhone(threadRaw.replace(/@c\.us$/, ""), ws.settings.whatsapp.countryCode);
  if (!phone) return NextResponse.json({ ok: true });

  // Deduplicación por id externo (WAHA puede reenviar el mismo evento)
  if (externalId) {
    const dupe = await prisma.message.findFirst({
      where: { workspaceId: ws.id, externalId },
      select: { id: true },
    });
    if (dupe) return NextResponse.json({ ok: true, duplicate: true });
  }

  // Mensaje que hemos enviado nosotros desde el teléfono → registrar y salir
  if (fromMe) {
    await prisma.message.create({
      data: {
        workspaceId: ws.id,
        phone,
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

  const contact = await findOrCreateContactByPhone({
    workspaceId: ws.id,
    phone,
    name: pushName,
    source: "whatsapp",
  });
  // Si estaba en "nuevos", pasa a "En conversación"
  if (contact.stage === "nuevos") {
    await moveContactToStage(contact.id, "conversacion");
  }

  await prisma.message.create({
    data: {
      workspaceId: ws.id,
      contactId: contact.id,
      phone,
      direction: "in",
      body: text,
      externalId: externalId || null,
      meta: { pushName: pushName ?? null, from: rawFrom },
    },
  });

  // Respuesta automática de SONIA
  if (ws.settings.whatsapp.autoReplyEnabled) {
    try {
      const reply = await runSoniaWhatsappAgent({
        workspaceId: ws.id,
        settings: ws.settings,
        phone,
      });
      if (reply) {
        // Responder SIEMPRE al chatId original (crítico con @lid)
        const sent = await sendText({ workspaceId: ws.id, to: threadRaw, text: reply });
        await prisma.message.create({
          data: {
            workspaceId: ws.id,
            contactId: contact.id,
            phone,
            direction: "out",
            body: reply,
            externalId: sent.messageId,
            meta: { sonia: true },
          },
        });
      }
    } catch (err: any) {
      // No romper el webhook: WAHA reintentaría y duplicaría el procesado.
      console.error("[sonia-whatsapp] error respondiendo:", err?.message);
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
