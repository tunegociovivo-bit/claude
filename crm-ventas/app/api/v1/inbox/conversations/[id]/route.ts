import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { sendSeen } from "@/lib/waha";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";
import { cancelQueuedAutoReplies } from "@/lib/inbox/outbound";

export const dynamic = "force-dynamic";

// GET → hilo completo (todos los números) + estado de IA y cola de salida.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { workspaceId } = await requireInboxUser();
    const conversation = await prisma.conversation.findFirst({ where: { id: params.id, workspaceId } });
    if (!conversation) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });

    const [messages, outbound, contact, line] = await Promise.all([
      prisma.message.findMany({
        where: { workspaceId, phone: conversation.phone },
        orderBy: { createdAt: "desc" },
        take: 150,
        select: { id: true, direction: true, body: true, createdAt: true, meta: true, lineId: true, ack: true },
      }),
      prisma.outboundMessage.findMany({
        where: {
          conversationId: conversation.id,
          OR: [
            { status: { in: ["queued", "sending"] } },
            { status: { in: ["failed", "blocked"] }, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
          ],
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, status: true, scheduledAt: true, lastError: true, origin: true, createdAt: true },
      }),
      conversation.contactId
        ? prisma.contact.findFirst({
            where: { id: conversation.contactId, workspaceId },
            select: { id: true, name: true, phone: true, stage: true, notes: true, source: true },
          })
        : Promise.resolve(null),
      conversation.lineId ? prisma.whatsappLine.findFirst({ where: { id: conversation.lineId, workspaceId } }) : Promise.resolve(null),
    ]);

    // Abrir el chat lo marca como leído (también en el móvil del cliente: doble check azul).
    if (conversation.unread > 0) {
      await prisma.conversation.update({ where: { id: conversation.id }, data: { unread: 0 } });
      if (line?.active && line.lastStatus === "WORKING") {
        void sendSeen({ workspaceId, session: line.sessionName, chatId: conversation.chatId || conversation.phone }).catch(
          () => undefined
        );
      }
    }

    const now = Date.now();
    const draftIsCurrent = Boolean(conversation.aiDraft && conversation.aiDraftForId === conversation.lastInboundId);
    return Response.json({
      conversation: {
        id: conversation.id,
        phone: conversation.phone,
        lineId: conversation.lineId,
        optedOut: conversation.optedOut,
        // El cliente volvió a escribir tras la baja: una persona puede contestarle.
        canReplyAfterOptOut: Boolean(
          conversation.optedOut &&
            conversation.lastInboundAt &&
            conversation.optedOutAt &&
            conversation.lastInboundAt > conversation.optedOutAt
        ),
        archived: conversation.archived,
        aiStatus: conversation.aiStatus,
        aiError: conversation.aiError,
        aiDraft: conversation.aiDraft,
        aiDraftAt: conversation.aiDraftAt,
        aiDraftCurrent: draftIsCurrent,
        humanUntil: conversation.humanUntil && conversation.humanUntil.getTime() > now ? conversation.humanUntil : null,
        lastInboundAt: conversation.lastInboundAt,
      },
      contact,
      line: line
        ? { id: line.id, label: line.label, phone: line.phone, aiMode: line.aiMode, active: line.active, lastStatus: line.lastStatus }
        : null,
      messages: messages.reverse(),
      outbound,
    });
  } catch (error) {
    return inboxError(error);
  }
}

const patchSchema = z.object({
  aiPaused: z.boolean().optional(), // true = una persona lleva el chat (la IA automática no responde)
  optedOut: z.boolean().optional(),
  archived: z.boolean().optional(),
  unread: z.literal(true).optional(), // marcar como no leído
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const { workspaceId } = await requireInboxUser();
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
    const conversation = await prisma.conversation.findFirst({ where: { id: params.id, workspaceId } });
    if (!conversation) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });
    const { aiPaused, optedOut, archived, unread } = parsed.data;
    const data: Record<string, unknown> = {};
    if (aiPaused !== undefined) data.humanUntil = aiPaused ? new Date(Date.now() + 7 * 86_400_000) : null;
    if (aiPaused) await cancelQueuedAutoReplies({ conversationId: conversation.id }, "Una persona ha tomado este chat");
    if (optedOut !== undefined) {
      data.optedOut = optedOut;
      data.optedOutAt = optedOut ? new Date() : null;
      if (optedOut) {
        await prisma.outboundMessage.updateMany({
          where: { conversationId: conversation.id, status: "queued" },
          data: { status: "canceled", lastError: "OPTED_OUT: baja marcada a mano" },
        });
      }
    }
    if (archived !== undefined) data.archived = archived;
    if (unread) data.unread = Math.max(1, conversation.unread);
    const updated = await prisma.conversation.update({ where: { id: conversation.id }, data });
    return Response.json({ ok: true, conversation: { id: updated.id, optedOut: updated.optedOut, archived: updated.archived, humanUntil: updated.humanUntil } });
  } catch (error) {
    return inboxError(error);
  }
}
