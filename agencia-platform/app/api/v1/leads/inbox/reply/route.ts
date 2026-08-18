/**
 * POST /api/v1/leads/inbox/reply   { phone, text }
 *
 * Responde a una conversación del inbox multi-WhatsApp DESDE el Hub. El
 * mensaje sale por el MISMO número (sesión/instancia) al que escribió el
 * lead (el de su último mensaje entrante), así la conversación nunca cambia
 * de número. Se registra como LeadInboxMessage direction:"out" para que el
 * hilo quede completo.
 *
 * Es una respuesta 1:1 a alguien que nos ha escrito: no pasa por la cola ni
 * por los límites anti-baneo de campaña (responder es lo más sano que hay).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { sendText } from "@/lib/leads/waha";
import { conversationWhere, outgoingReplyIdentity, resolveConversationIdentity } from "@/lib/leads/conversation-identity";

export const dynamic = "force-dynamic";

const schema = z.object({
  phone: z.string().min(6).max(20),
  leadId: z.string().optional(),
  text: z.string().min(1).max(4000)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { phone, text, leadId } = parsed.data;
  const identity = await resolveConversationIdentity(prisma, api.workspaceId, phone, leadId);

  // Canal de salida: el del último mensaje ENTRANTE de ese teléfono.
  const lastIn = await prisma.leadInboxMessage.findFirst({
    where: {
      ...conversationWhere(api.workspaceId, identity.phones, identity.leadIds),
      direction: "in",
    },
    orderBy: { receivedAt: "desc" },
    select: { instanceName: true, leadId: true, fromPhone: true, phoneNormalized: true, meta: true }
  });
  if (!lastIn) {
    throw new ApiError(404, "no_conversation", "No hay conversación entrante con ese teléfono.");
  }

  // chatId al que responder: el ORIGINAL del último entrante (con su sufijo
  // @c.us/@lid). Para usuarios con LID, reconstruir `${num}@c.us` no enruta;
  // hay que devolver al mismo chatId que mandó WAHA. Prioridad:
  // meta.payload.from (chatId completo) → fromPhone → el teléfono normalizado.
  const meta: any = lastIn.meta ?? {};
  const originalChatId: string =
    (typeof meta?.payload?.from === "string" && meta.payload.from) ||
    (typeof meta?.from === "string" && meta.from) ||
    (lastIn.fromPhone && String(lastIn.fromPhone).includes("@") ? String(lastIn.fromPhone) : "") ||
    phone;

  let externalMessageId: string | null = null;
  try {
    const out = await sendText({
      workspaceId: api.workspaceId,
      phoneNormalized: originalChatId,
      text,
      session: lastIn.instanceName ?? undefined
    });
    externalMessageId = out.messageId ?? null;
  } catch (e: any) {
    throw new ApiError(502, "send_failed", `No se pudo enviar: ${e?.message ?? e}`);
  }

  // Se guarda con los identificadores del HILO VIVO (para que la respuesta quede unida a la
  // conversación reciente), pero `phoneNormalized` mantiene el número normalizado — nunca el
  // alias crudo con sufijo @c.us/@lid.
  const replyIds = outgoingReplyIdentity(lastIn, phone);
  const saved = await prisma.leadInboxMessage.create({
    data: {
      workspaceId: api.workspaceId,
      leadId: lastIn.leadId,
      fromPhone: replyIds.fromPhone,
      phoneNormalized: replyIds.phoneNormalized,
      channel: "whatsapp",
      direction: "out",
      body: text,
      read: true,
      meta: { source: "human_reply", userId: api.userId ?? null },
      externalMessageId,
      instanceName: lastIn.instanceName
    }
  });

  return NextResponse.json({
    ok: true,
    id: saved.id,
    at: saved.receivedAt.toISOString(),
    instanceName: lastIn.instanceName
  });
});
