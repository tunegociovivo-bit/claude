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
  const messageBody =
    body?.payload?.body ?? // WAHA v2
    body?.body ??
    body?.text ??
    body?.message?.body ??
    body?.data?.message?.text?.body ??
    body?.data?.message?.conversation ??
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
