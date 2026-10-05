import "server-only";
import { prisma } from "@/lib/prisma";
import { ensurePrimaryLine } from "@/lib/inbox/lines";

function preview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

export async function upsertConversationOnInbound(opts: {
  workspaceId: string;
  phone: string;
  chatId: string;
  lineId: string | null;
  contactId: string | null;
  messageId: string;
  body: string;
  at: Date;
}) {
  return prisma.conversation.upsert({
    where: { workspaceId_phone: { workspaceId: opts.workspaceId, phone: opts.phone } },
    create: {
      workspaceId: opts.workspaceId,
      phone: opts.phone,
      chatId: opts.chatId,
      lineId: opts.lineId,
      contactId: opts.contactId,
      unread: 1,
      lastMessageAt: opts.at,
      lastInboundAt: opts.at,
      lastInboundId: opts.messageId,
      lastPreview: preview(opts.body),
      lastDirection: "in",
    },
    update: {
      chatId: opts.chatId,
      ...(opts.lineId ? { lineId: opts.lineId } : {}),
      ...(opts.contactId ? { contactId: opts.contactId } : {}),
      unread: { increment: 1 },
      lastMessageAt: opts.at,
      lastInboundAt: opts.at,
      lastInboundId: opts.messageId,
      lastPreview: preview(opts.body),
      lastDirection: "in",
      archived: false,
    },
  });
}

export async function touchConversationOnOutbound(opts: {
  workspaceId: string;
  phone: string;
  chatId?: string;
  lineId?: string | null;
  contactId?: string | null;
  body: string;
  at: Date;
  keepLine?: boolean; // no cambiar el número de un chat existente
}) {
  return prisma.conversation.upsert({
    where: { workspaceId_phone: { workspaceId: opts.workspaceId, phone: opts.phone } },
    create: {
      workspaceId: opts.workspaceId,
      phone: opts.phone,
      chatId: opts.chatId ?? opts.phone,
      lineId: opts.lineId ?? null,
      contactId: opts.contactId ?? null,
      lastMessageAt: opts.at,
      lastPreview: preview(opts.body),
      lastDirection: "out",
    },
    update: {
      lastMessageAt: opts.at,
      lastPreview: preview(opts.body),
      lastDirection: "out",
      ...(opts.lineId && !opts.keepLine ? { lineId: opts.lineId } : {}),
      ...(opts.contactId ? { contactId: opts.contactId } : {}),
    },
  });
}

// Primera apertura de la bandeja: crea las conversaciones a partir de los
// mensajes que ya existían y asigna los mensajes antiguos a la línea principal.
const backfillRunning = new Set<string>();

export async function backfillConversations(workspaceId: string) {
  const state = await prisma.inboxLearning.findUnique({ where: { workspaceId }, select: { backfilledAt: true } });
  if (state?.backfilledAt || backfillRunning.has(workspaceId)) return;
  backfillRunning.add(workspaceId);
  try {
    const primary = await ensurePrimaryLine(workspaceId);
    if (primary) {
      await prisma.message.updateMany({ where: { workspaceId, lineId: null }, data: { lineId: primary.id } });
    }
    const threads = await prisma.message.groupBy({
      by: ["phone"],
      where: { workspaceId },
      _max: { createdAt: true },
    });
    for (const thread of threads) {
      const exists = await prisma.conversation.findUnique({
        where: { workspaceId_phone: { workspaceId, phone: thread.phone } },
        select: { id: true },
      });
      if (exists) continue;
      const [last, lastIn, withContact] = await Promise.all([
        prisma.message.findFirst({ where: { workspaceId, phone: thread.phone }, orderBy: { createdAt: "desc" } }),
        prisma.message.findFirst({
          where: { workspaceId, phone: thread.phone, direction: "in" },
          orderBy: { createdAt: "desc" },
        }),
        prisma.message.findFirst({
          where: { workspaceId, phone: thread.phone, contactId: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { contactId: true },
        }),
      ]);
      if (!last) continue;
      const from = String(((lastIn?.meta ?? {}) as Record<string, unknown>).from ?? "");
      await prisma.conversation
        .create({
          data: {
            workspaceId,
            phone: thread.phone,
            chatId: from && !from.endsWith("@g.us") ? from : thread.phone,
            lineId: last.lineId ?? primary?.id ?? null,
            contactId: withContact?.contactId ?? null,
            lastMessageAt: last.createdAt,
            lastInboundAt: lastIn?.createdAt ?? null,
            lastInboundId: lastIn?.id ?? null,
            lastPreview: preview(last.body),
            lastDirection: last.direction,
          },
        })
        .catch(() => undefined);
    }
    await prisma.inboxLearning.upsert({
      where: { workspaceId },
      create: { workspaceId, backfilledAt: new Date() },
      update: { backfilledAt: new Date() },
    });
  } finally {
    backfillRunning.delete(workspaceId);
  }
}
