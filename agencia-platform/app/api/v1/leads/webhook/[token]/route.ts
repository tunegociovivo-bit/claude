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
import { ingestInbox } from "@/lib/leads/inbox";
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

  // Marcador "el webhook está vivo": al menos UN evento ha llegado. Lo usamos
  // en la UI de Inbox/Ajustes para indicar si WAHA está realmente apuntando
  // aquí. Guardamos también el último evento bruto truncado para diagnosis.
  void prisma.workspace
    .update({
      where: { id: ws.id },
      data: {
        settings: {
          ...((ws.settings as any) ?? {}),
          leads: {
            ...(((ws.settings as any) ?? {}).leads ?? {}),
            webhookLastHit: new Date().toISOString(),
            webhookLastEvent: String(body?.event ?? body?.type ?? "unknown")
          }
        }
      }
    })
    .catch((e) => console.warn("[leads webhook] no se pudo persistir lastHit:", e?.message ?? e));

  // ── Recibos de entrega (ACK) de WAHA ────────────────────────────────────
  // WAHA emite `message.ack` con el estado de NUESTROS envíos:
  //   ack -1 ERROR · 0 PENDING · 1 SERVER · 2 DEVICE(entregado) · 3 READ · 4 PLAYED
  // Lo usamos para confirmar entrega real (o detectar que NO se entregó) y
  // dejar de depender del "200 OK" del envío. Se procesa ANTES del guard
  // fromMe porque los acks son, por definición, de mensajes nuestros.
  const isAck =
    body?.event === "message.ack" ||
    typeof body?.payload?.ack === "number" ||
    typeof body?.payload?.ackName === "string";
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
    return NextResponse.json({ ok: true, ack: ackName || ackNum });
  }

  // WAHA: ignorar mensajes fromMe (echo de los nuestros)
  const fromMe =
    body?.payload?.fromMe === true ||
    body?.data?.key?.fromMe === true ||
    body?.message?.fromMe === true;
  if (fromMe) {
    return NextResponse.json({ ok: true, ignored: "from_me" });
  }

  const fromPhone =
    body?.payload?.from ?? // WAHA v2
    body?.from ??
    body?.data?.key?.remoteJid ??
    body?.data?.from ??
    body?.message?.from ??
    body?.sender ??
    "";
  // El cuerpo del mensaje llega en rutas distintas según proveedor/motor:
  //  - WAHA v2: payload.body
  //  - Evolution/Baileys: data.message.{conversation | extendedTextMessage.text
  //    | imageMessage.caption | ...}, a veces envuelto en ephemeralMessage.
  const m: any = body?.data?.message ?? body?.message ?? {};
  const messageBody: string =
    body?.payload?.body ?? // WAHA v2
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

  if (!fromPhone || typeof messageBody !== "string" || !messageBody.trim()) {
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
    return NextResponse.json({ ok: true, messageId: out.messageId, classification: out.classification });
  } catch (e: any) {
    console.error("[leads webhook] ingest error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
