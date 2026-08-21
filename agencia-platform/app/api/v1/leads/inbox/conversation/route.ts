/**
 * GET /api/v1/leads/inbox/conversation?phone=34666...
 *
 * Hilo COMPLETO de una conversación: mensajes del inbox (entrantes y
 * respuestas manuales) + los envíos de campaña (LeadMessage) a ese teléfono,
 * fusionados y en orden cronológico. Marca como leídos los entrantes.
 * Devuelve también el canal de respuesta (mismo número por el que escribió
 * el lead) y si el teléfono está en opt-out.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { realPhoneFromMeta, isLidFromMeta, looksLikePhone } from "@/lib/leads/lid";
import { conversationWhere, resolveConversationIdentity } from "@/lib/leads/conversation-identity";
import { conversationTaskWhere } from "@/lib/leads/conversation-task";
import { mergeLeadConversationItems, type LeadConversationItem } from "@/lib/leads/conversation-items";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const phone = new URL(req.url).searchParams.get("phone")?.trim();
  if (!phone) throw new ApiError(400, "validation_error", "Falta ?phone=");
  const leadId = new URL(req.url).searchParams.get("leadId")?.trim() || null;
  const identity = await resolveConversationIdentity(prisma, api.workspaceId, phone, leadId);
  const messageWhere = conversationWhere(api.workspaceId, identity.phones, identity.leadIds);

  const [inboxMsgs, campaignMsgs, optout, convMeta, conversationTask] = await Promise.all([
    prisma.leadInboxMessage.findMany({
      where: messageWhere,
      orderBy: { receivedAt: "asc" },
      take: 500,
      include: { lead: { select: { id: true, name: true, phone: true, commercialTaskId: true, commercialSentAt: true } } }
    }),
    prisma.leadMessage.findMany({
      where: {
        workspaceId: api.workspaceId,
        OR: [
          { phoneNormalized: { in: identity.phones } },
          ...(identity.leadIds.length ? [{ leadId: { in: identity.leadIds } }] : [])
        ],
        status: { in: ["sent", "delivered", "read"] }
      },
      orderBy: { sentAt: "asc" },
      take: 200,
      select: { id: true, renderedMessage: true, sentAt: true, instanceName: true, status: true, externalMessageId: true }
    }),
    prisma.leadOptout.findUnique({
      where: { workspaceId_phone: { workspaceId: api.workspaceId, phone } },
      select: { id: true }
    }),
    prisma.leadConversationMeta.findUnique({
      where: { workspaceId_phone: { workspaceId: api.workspaceId, phone } }
    }),
    prisma.task.findFirst({
      where: conversationTaskWhere(api.workspaceId, identity.phones, identity.leadIds),
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true }
    })
  ]);

  const items = mergeLeadConversationItems([
    ...inboxMsgs.map((m) => ({
      id: m.id,
      externalMessageId: m.externalMessageId,
      direction: (m.direction === "out" ? "out" : "in") as "in" | "out",
      body: m.body,
      at: m.receivedAt.toISOString(),
      instanceName: m.instanceName,
      kind: "inbox" as const,
      classification: m.classification,
      source: m.meta && typeof m.meta === "object" && !Array.isArray(m.meta) && "source" in m.meta
        ? String(m.meta.source ?? "") || null
        : null,
      // Check de oro: acuse de recibo de WhatsApp para tus respuestas.
      ack: m.ack
    })),
    ...campaignMsgs.map((m) => ({
      id: m.id,
      externalMessageId: m.externalMessageId,
      direction: "out" as const,
      body: m.renderedMessage,
      at: (m.sentAt ?? new Date(0)).toISOString(),
      instanceName: m.instanceName,
      kind: "campaign" as const,
      status: m.status,
      ack: m.status === "read" ? 3 : m.status === "delivered" ? 2 : m.status === "sent" ? 1 : null
    }))
  ] satisfies LeadConversationItem[]);

  // Canal de respuesta: el del último mensaje ENTRANTE (responder por el
  // mismo número al que escribió el lead).
  const lastIn = [...inboxMsgs].reverse().find((m) => m.direction === "in");
  const lead = inboxMsgs.find((m) => m.lead)?.lead ?? null;

  // Marcar entrantes como leídos (fire-and-forget).
  void prisma.leadInboxMessage
    .updateMany({
      where: { ...messageWhere, direction: "in", read: false },
      data: { read: true }
    })
    .catch(() => {});

  // Identidad real: número real si WAHA lo manda en algún entrante; si el
  // contacto es un LID, marcamos que el teléfono está oculto.
  let realPhone: string | null = convMeta?.realPhone ?? (looksLikePhone(phone) ? phone : null);
  let isLid = false;
  for (const m of inboxMsgs) {
    if (m.direction !== "in") continue;
    if (!realPhone) {
      const rp = realPhoneFromMeta(m.meta);
      if (rp) realPhone = rp;
    }
    if (isLidFromMeta(m.meta)) isLid = true;
  }

  return NextResponse.json({
    phone,
    realPhone,
    isLid,
    lead: lead ? {
      id: lead.id,
      name: lead.name,
      phone: lead.phone ?? null,
      commercialTaskId: lead.commercialTaskId ?? null,
      commercialSentAt: lead.commercialSentAt?.toISOString() ?? null
    } : null,
    displayName: convMeta?.displayName ?? null,
    note: convMeta?.note ?? null,
    priority: convMeta?.priority ?? "none",
    status: convMeta?.status ?? "pending",
    archived: convMeta?.archived ?? false,
    followupAt: convMeta?.followupAt ? convMeta.followupAt.toISOString() : null,
    followupNote: convMeta?.followupNote ?? null,
    aiScore: convMeta?.aiScore ?? null,
    aiScoreReason: convMeta?.aiScoreReason ?? null,
    aiDraft: convMeta?.aiDraft ?? null,
    aiCallNow: convMeta?.aiCallNow ?? false,
    aiCallScript: convMeta?.aiCallScript ?? null,
    autoFollowupStep: convMeta?.autoFollowupStep ?? 0,
    autoFollowupOff: convMeta?.autoFollowupOff ?? false,
    replyChannel: lastIn?.instanceName ?? null,
    optedOut: !!optout,
    conversationTask,
    items
  });
});
