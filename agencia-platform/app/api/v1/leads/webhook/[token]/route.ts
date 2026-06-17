/**
 * Webhook público WAHA / Evolution para mensajes entrantes. El token de
 * la ruta se compara con `workspace.settings.integrations.evolution.webhookToken`
 * (o el nuevo `workspace.settings.leads.webhookToken`).
 *
 * Configurar en WAHA: webhook URL =
 *   https://<hub>/api/v1/leads/webhook/<token>
 *
 * Soporta payload nativo WAHA:
 *   { event: "message", session: "default",
 *     payload: { from: "34666...@c.us", body: "...", fromMe: false } }
 * y otros formatos legacy.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ingestInbox, recordOutboundFromPhone } from "@/lib/leads/inbox";
import { extractWahaMessageId } from "@/lib/leads/waha";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const workspaces = await prisma.workspace.findMany();
  const ws = workspaces.find((w) => {
    const s = (w.settings as any) ?? {};
    return (
      s?.leads?.webhookToken === params.token ||
      s?.integrations?.evolution?.webhookToken === params.token
    );
  });
  if (!ws) {
    return NextResponse.json({ error: { code: "bad_token", message: "Token desconocido" } }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "bad_json", message: "Payload inválido" } }, { status: 400 });
  }

  // Persiste el estado del webhook para diagnóstico. Separamos el ÚLTIMO
  // evento de MENSAJE (msg*) del último evento cualquiera, porque las
  // campañas activas generan muchos ACKs que machacarían el dato del mensaje
  // entrante que estamos intentando depurar.
  function note(decision: string, extra?: { from?: string; text?: string; isMessage?: boolean }) {
    const leadsPrev = (((ws!.settings as any) ?? {}).leads ?? {});
    // Número WAHA conectado (envelope WAHA trae `me: { id, pushName }`). Sirve
    // para confirmar a qué número hay que escribirle.
    const meId = body?.me?.id ?? body?.me ?? body?.payload?.me?.id ?? null;
    const common = {
      webhookLastHit: new Date().toISOString(),
      webhookLastEvent: String(body?.event ?? body?.type ?? "unknown"),
      webhookLastDecision: decision,
      webhookLastFrom: (extra?.from ?? "").slice(0, 40) || null,
      webhookLastBody: (extra?.text ?? "").slice(0, 80) || null,
      webhookLastKeys: Object.keys(body ?? {}).slice(0, 12).join(","),
      webhookMe: meId ? String(meId).slice(0, 40) : (leadsPrev.webhookMe ?? null),
      webhookSession: body?.session ? String(body.session).slice(0, 40) : (leadsPrev.webhookSession ?? null)
    };
    const msg = extra?.isMessage
      ? {
          webhookLastMsgAt: new Date().toISOString(),
          webhookLastMsgEvent: String(body?.event ?? body?.type ?? "unknown"),
          webhookLastMsgDecision: decision,
          webhookLastMsgFrom: (extra?.from ?? "").slice(0, 40) || null,
          webhookLastMsgBody: (extra?.text ?? "").slice(0, 80) || null,
          webhookLastMsgPayloadKeys: Object.keys(body?.payload ?? {}).slice(0, 14).join(",")
        }
      : {};
    void prisma.workspace
      .update({
        where: { id: ws!.id },
        data: { settings: { ...((ws!.settings as any) ?? {}), leads: { ...leadsPrev, ...common, ...msg } } }
      })
      .catch((e) => console.warn("[leads webhook] no se pudo persistir lastHit:", e?.message ?? e));
  }

  // ── Recibos de entrega (ACK) de WAHA ────────────────────────────────────
  // WAHA emite `message.ack` con el estado de NUESTROS envíos:
  //   ack -1 ERROR · 0 PENDING · 1 SERVER · 2 DEVICE(entregado) · 3 READ · 4 PLAYED
  // Lo usamos para confirmar entrega real (o detectar que NO se entregó) y
  // dejar de depender del "200 OK" del envío. Se procesa ANTES del guard
  // fromMe porque los acks son, por definición, de mensajes nuestros.
  // OJO: WAHA incluye `ack`/`ackName` TAMBIÉN dentro del payload de los
  // mensajes normales (es el estado actual del mensaje), así que detectar
  // acks solo por esos campos se TRAGABA los mensajes entrantes (event:
  // "message" → clasificado como ack → nunca llegaba al Inbox). Un ack lo es
  // por su EVENTO; los campos sueltos solo cuentan en formatos legacy sin
  // evento de mensaje.
  const eventName = String(body?.event ?? "");
  const isAck =
    eventName === "message.ack" ||
    (eventName !== "message" &&
      eventName !== "message.any" &&
      (typeof body?.payload?.ack === "number" || typeof body?.payload?.ackName === "string"));
  if (isAck) {
    const ackId = extractWahaMessageId(body?.payload ?? body);
    const ackNum: number | null =
      typeof body?.payload?.ack === "number" ? body.payload.ack : null;
    const ackName: string = String(body?.payload?.ackName ?? "").toUpperCase();
    if (!ackId) {
      return NextResponse.json({ ok: true, ignored: "ack_sin_id" });
    }
    try {
      if (ackName === "ERROR" || ackNum === -1) {
        // WhatsApp no pudo entregar → marcar failed (solo si no consta ya
        // entregado/leído). Esto destapa el envío fantasma con NOWEB.
        await prisma.leadMessage.updateMany({
          where: {
            workspaceId: ws.id,
            externalMessageId: ackId,
            status: { in: ["sent", "sending", "queued"] }
          },
          data: { status: "failed", lastError: "WhatsApp devolvió ACK ERROR (no entregado)" }
        });
      } else if (ackName === "READ" || ackName === "PLAYED" || (ackNum ?? 0) >= 3) {
        await prisma.leadMessage.updateMany({
          where: { workspaceId: ws.id, externalMessageId: ackId, status: { in: ["sent", "delivered"] } },
          data: { status: "read" }
        });
      } else if (ackName === "DEVICE" || ackNum === 2) {
        await prisma.leadMessage.updateMany({
          where: { workspaceId: ws.id, externalMessageId: ackId, status: "sent" },
          data: { status: "delivered" }
        });
      }
      // ack 0/1 (PENDING/SERVER): nada que hacer, ya está en "sent".
    } catch (e: any) {
      console.warn("[leads webhook] ack update error:", e?.message ?? e);
    }
    // CHECK DE ORO: el mismo ACK aplica a los mensajes SALIENTES del inbox
    // (tus respuestas). Guardamos el nivel numérico sin degradar (un READ no
    // puede volver a DEVICE). Mapea ackName→número cuando no llega ack numérico.
    try {
      const lvl =
        ackNum != null
          ? ackNum
          : ackName === "ERROR"
            ? -1
            : ackName === "PLAYED"
              ? 4
              : ackName === "READ"
                ? 3
                : ackName === "DEVICE"
                  ? 2
                  : ackName === "SERVER"
                    ? 1
                    : 0;
      await prisma.leadInboxMessage.updateMany({
        where: {
          workspaceId: ws.id,
          direction: "out",
          externalMessageId: ackId,
          // No degradar: solo si el nuevo nivel es mayor (o aún no hay ack).
          OR: [{ ack: null }, { ack: { lt: lvl } }]
        },
        data: { ack: lvl, ackAt: new Date() }
      });
    } catch (e: any) {
      console.warn("[leads webhook] ack inbox update error:", e?.message ?? e);
    }
    note(`ack:${ackName || ackNum}`);
    return NextResponse.json({ ok: true, ack: ackName || ackNum });
  }

  // Teléfono / chatId del remitente. Con el nuevo sistema LID de WhatsApp,
  // `payload.from` puede ser un id privado (…@lid) sin teléfono legible. Si en
  // el payload hay un número real (…@c.us) en otro campo, lo preferimos para
  // mostrar; el chatId original (para responder) se conserva en meta.
  const fromCandidates = [
    body?.payload?.from,
    body?.payload?.author,
    body?.payload?.participant,
    body?.payload?._data?.author,
    body?.payload?._data?.from,
    body?.payload?._data?.id?.remote,
    body?.from,
    body?.data?.key?.remoteJid,
    body?.data?.from,
    body?.message?.from,
    body?.sender
  ].filter((x): x is string => typeof x === "string" && x.length > 0);
  const realPhone = fromCandidates.find((c) => /@c\.us$/i.test(c) || /^\+?\d{6,15}@/.test(c) || /^\+?\d{6,15}$/.test(c));
  const fromPhone = realPhone ?? fromCandidates[0] ?? "";

  // El cuerpo del mensaje llega en rutas distintas según proveedor/motor:
  //  - WAHA v2: payload.body
  //  - Evolution/Baileys: data.message.{conversation | extendedTextMessage.text
  //    | imageMessage.caption | ...}, a veces envuelto en ephemeralMessage.
  const m: any = body?.data?.message ?? body?.message ?? body?.payload?._data?.message ?? {};
  const messageBody: string =
    body?.payload?.body ?? // WAHA v2
    body?.payload?.text ?? // algunos motores WAHA
    body?.payload?._data?.body ?? // WAHA NOWEB/WEBJS (texto en _data)
    body?.body ??
    body?.text ??
    (typeof body?.message?.body === "string" ? body.message.body : undefined) ??
    m?.conversation ??
    m?.extendedTextMessage?.text ??
    m?.text?.body ??
    m?.ephemeralMessage?.message?.conversation ??
    m?.ephemeralMessage?.message?.extendedTextMessage?.text ??
    m?.imageMessage?.caption ??
    m?.videoMessage?.caption ??
    m?.documentMessage?.caption ??
    m?.buttonsResponseMessage?.selectedDisplayText ??
    m?.listResponseMessage?.title ??
    "";
  const externalMessageId =
    body?.payload?.id ?? body?.data?.key?.id ?? body?.id ?? null;
  const instanceName = body?.session ?? body?.instance ?? null;

  // ¿Mensaje fromMe? = respuesta que TÚ enviaste. Antes se ignoraba; ahora la
  // registramos como SALIENTE para que aparezca en la conversación del panel
  // (incluidas las respuestas escritas desde el TELÉFONO). El dedupe por id
  // evita duplicar los envíos hechos desde el propio panel.
  const fromMe =
    body?.payload?.fromMe === true ||
    body?.data?.key?.fromMe === true ||
    body?.message?.fromMe === true;
  if (fromMe) {
    // En un saliente, el "otro" de la conversación es el DESTINATARIO.
    const toCandidates = [
      body?.payload?.to,
      body?.payload?._data?.to,
      body?.payload?._data?.id?.remote,
      body?.data?.key?.remoteJid,
      body?.payload?.chatId,
      body?.to
    ].filter((x): x is string => typeof x === "string" && x.length > 0);
    const toReal =
      toCandidates.find((c) => /@c\.us$/i.test(c) || /^\+?\d{6,15}@/.test(c) || /^\+?\d{6,15}$/.test(c)) ??
      toCandidates[0] ??
      fromPhone; // último recurso: algunos motores ponen el chat en `from`
    if (toReal && messageBody.trim()) {
      try {
        await recordOutboundFromPhone({
          workspaceId: ws.id,
          toPhone: String(toReal),
          text: messageBody,
          externalMessageId: externalMessageId ? String(externalMessageId) : null,
          instanceName: instanceName ? String(instanceName) : null,
          meta: body
        });
      } catch (e: any) {
        console.warn("[leads webhook] outbound record error:", e?.message ?? e);
      }
    }
    note("from_me_out", { isMessage: true, from: String(toReal ?? "") });
    return NextResponse.json({ ok: true, recorded: "outbound" });
  }

  if (!fromPhone || typeof messageBody !== "string" || !messageBody.trim()) {
    note("missing_fields", { isMessage: true, from: String(fromPhone ?? ""), text: String(messageBody ?? "") });
    return NextResponse.json({ ok: true, ignored: "missing_fields" });
  }

  try {
    const out = await ingestInbox({
      workspaceId: ws.id,
      fromPhone: String(fromPhone),
      text: messageBody,
      externalMessageId: externalMessageId ? String(externalMessageId) : null,
      instanceName: instanceName ? String(instanceName) : null,
      meta: body
    });
    note("ingested", { isMessage: true, from: String(fromPhone), text: messageBody });
    return NextResponse.json({ ok: true, messageId: out.messageId, classification: out.classification });
  } catch (e: any) {
    console.error("[leads webhook] ingest error:", e);
    note(`ingest_error:${(e?.message ?? String(e)).slice(0, 60)}`, { isMessage: true, from: String(fromPhone), text: messageBody });
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
