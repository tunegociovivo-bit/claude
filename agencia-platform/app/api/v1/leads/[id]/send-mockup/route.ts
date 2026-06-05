/**
 * POST /api/v1/leads/[id]/send-mockup   { caption?: string }
 *
 * Genera el mockup "antes/después" de la ficha de Google del lead y lo envía
 * como imagen por WhatsApp (WAHA/Evolution), respetando el multi-número.
 * Envío directo (acción manual del admin), con comprobaciones de móvil y baja.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { normalizePhone, sendImage } from "@/lib/leads/waha";
import { pickEnqueueChannel } from "@/lib/leads/channels";
import { renderMockupPng } from "@/lib/leads/mockup";

const schema = z.object({ caption: z.string().max(1000).optional() });

const DEFAULT_CAPTION =
  "Te enseño cómo se vería tu ficha de Google optimizada 👀 ¿Te cuento cómo lo conseguimos?";

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  const caption = (parsed.success && parsed.data.caption?.trim()) || DEFAULT_CAPTION;

  const lead = await prisma.lead.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: {
      id: true,
      name: true,
      category: true,
      province: true,
      rating: true,
      reviewsCount: true,
      phone: true,
      internationalPhone: true,
      contactStatus: true
    }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const countryCode: string = (ws?.settings as any)?.leads?.whatsappCountryCode ?? "34";
  const phone = normalizePhone(lead.internationalPhone ?? lead.phone ?? null, countryCode);
  if (!phone) throw new ApiError(400, "no_phone", "El lead no tiene teléfono válido");
  if (!/^34[67]\d{8}$/.test(phone)) {
    throw new ApiError(400, "not_mobile", "El mockup solo se envía a móviles (WhatsApp); este número es fijo");
  }

  // Respetar bajas.
  const optout = await prisma.leadOptout.findFirst({
    where: { workspaceId: api.workspaceId, OR: [{ leadId: lead.id }, { phone }] },
    select: { id: true }
  });
  if (optout) throw new ApiError(409, "opted_out", "Este lead pidió no recibir mensajes");

  // Generar el PNG y enviarlo (multi-número: elige canal).
  const png = await renderMockupPng(lead);
  const session = (await pickEnqueueChannel(api.workspaceId)) ?? undefined;

  let messageId = "";
  try {
    const out = await sendImage({
      workspaceId: api.workspaceId,
      phoneNormalized: phone,
      imageBase64: png.toString("base64"),
      caption,
      session
    });
    messageId = out.messageId;
  } catch (e: any) {
    throw new ApiError(502, "send_failed", e?.message ?? "No se pudo enviar la imagen");
  }

  // Registrar en el historial del lead.
  await prisma.leadMessage.create({
    data: {
      workspaceId: api.workspaceId,
      leadId: lead.id,
      renderedMessage: `🖼️ [Mockup] ${caption}`,
      channel: "whatsapp",
      phoneNormalized: phone,
      status: "sent",
      sentAt: new Date(),
      externalMessageId: messageId || null,
      instanceName: session
    }
  });
  await prisma.lead.updateMany({
    where: { id: lead.id, contactStatus: "pending" },
    data: { contactStatus: "contacted" }
  });

  return NextResponse.json({ ok: true, messageId });
});
