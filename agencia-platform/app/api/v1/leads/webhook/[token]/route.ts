/**
 * Webhook público de la Evolution API / WAHA para mensajes entrantes.
 * El token de la ruta se compara con un valor guardado en
 * workspace.settings.integrations.evolution.webhookToken (no cifrado;
 * es un identificador opaco, no una credencial sensible).
 *
 * Configurar en Evolution: webhook URL = https://hub.negociovivo.app/api/v1/leads/webhook/<token>
 *
 * Payload esperado (Evolution/WAHA estilo): { from: "+34...", body: "...", ... }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  // Buscamos qué workspace tiene este token configurado
  const workspaces = await prisma.workspace.findMany();
  const ws = workspaces.find((w) => {
    const s = (w.settings as any) ?? {};
    return s?.integrations?.evolution?.webhookToken === params.token;
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

  // Heurística de extracción — diferentes proveedores envían formatos distintos.
  const fromPhone =
    body?.from ??
    body?.data?.key?.remoteJid ??
    body?.data?.from ??
    body?.message?.from ??
    body?.sender ??
    "";
  const messageBody =
    body?.body ??
    body?.text ??
    body?.message?.body ??
    body?.data?.message?.text?.body ??
    body?.data?.message?.conversation ??
    "";

  if (!fromPhone || typeof messageBody !== "string" || !messageBody.trim()) {
    return NextResponse.json({ ok: true, ignored: "missing_fields" });
  }

  // Localizar lead si hay match por teléfono normalizado
  const cleanPhone = String(fromPhone).replace(/[^\d+]/g, "");
  const lead = cleanPhone
    ? await prisma.lead.findFirst({
        where: { workspaceId: ws.id, phone: { contains: cleanPhone.slice(-9) } }
      })
    : null;

  await prisma.leadInboxMessage.create({
    data: {
      workspaceId: ws.id,
      leadId: lead?.id ?? null,
      fromPhone: String(fromPhone).slice(0, 60),
      body: messageBody.slice(0, 4000),
      meta: body as any
    }
  });

  // Si el remitente coincide con un lead, marcamos contactStatus → REPLIED
  if (lead && lead.contactStatus !== "REPLIED" && lead.contactStatus !== "CONVERTED") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { contactStatus: "REPLIED" }
    });
  }

  return NextResponse.json({ ok: true });
}
