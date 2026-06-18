/**
 * POST /api/v1/leads/[id]/send-ranking   { caption?: string }
 *
 * Genera el informe "tú vs tu competencia en Google" del lead y lo envía como
 * imagen por WhatsApp (respeta multi-número, bajas y solo móviles), igual que
 * send-mockup. El pie de foto se autogenera según su posición real.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { normalizePhone, sendImage } from "@/lib/leads/waha";
import { pickEnqueueChannel } from "@/lib/leads/channels";
import { getCompetitorRanking, type CompetitorRanking } from "@/lib/leads/competitors";
import { renderRankingPng } from "@/lib/leads/ranking-card";

const schema = z.object({ caption: z.string().max(1000).optional() });

function autoCaption(data: CompetitorRanking, name: string): string {
  const q = data.query;
  if (data.leadPosition === 1) {
    return `¡${name} aparece el nº1 en Google para "${q}"! 🏆 Te enseño cómo mantenerlo y sacarle más clientes.`;
  }
  if (data.leadPosition) {
    return `📍 Mira dónde sale ${name} en Google para "${q}": posición #${data.leadPosition}, con ${data.aboveCount} competidor${data.aboveCount === 1 ? "" : "es"} por delante llevándose esas llamadas. Te enseño cómo subir al top 3 👆`;
  }
  return `📍 ${name} no aparece en el top 20 de Google para "${q}" — esos clientes se los están llevando tus competidores. Te enseño cómo posicionarte arriba 👆`;
}

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  const captionOverride = parsed.success ? parsed.data.caption?.trim() : undefined;

  const lead = await prisma.lead.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: {
      id: true,
      placeId: true,
      name: true,
      category: true,
      types: true,
      province: true,
      formattedAddress: true,
      address: true,
      latitude: true,
      longitude: true,
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
    throw new ApiError(400, "not_mobile", "El informe solo se envía a móviles (WhatsApp); este número es fijo");
  }

  const optout = await prisma.leadOptout.findFirst({
    where: { workspaceId: api.workspaceId, OR: [{ leadId: lead.id }, { phone }] },
    select: { id: true }
  });
  if (optout) throw new ApiError(409, "opted_out", "Este lead pidió no recibir mensajes");

  const data = await getCompetitorRanking(api.workspaceId, lead as any);
  if (!data) throw new ApiError(400, "no_ranking", "No se pudo obtener el ranking de Google (revisa categoría/zona y la API key de Places).");

  const caption = captionOverride || autoCaption(data, lead.name);
  const png = await renderRankingPng(data);
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

  await prisma.leadMessage.create({
    data: {
      workspaceId: api.workspaceId,
      leadId: lead.id,
      renderedMessage: `📊 [Posicionamiento] ${caption}`,
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

  return NextResponse.json({ ok: true, messageId, leadPosition: data.leadPosition, aboveCount: data.aboveCount });
});
