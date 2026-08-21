import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { formatWhatsappAttachmentBody, validateWhatsappAttachment } from "@/lib/leads/commercial-reply-alert";
import { conversationWhere, outgoingReplyIdentity, resolveConversationIdentity } from "@/lib/leads/conversation-identity";
import { sendFile } from "@/lib/leads/waha";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const form = await req.formData().catch(() => null);
  const phone = String(form?.get("phone") ?? "").trim();
  const caption = String(form?.get("caption") ?? "").trim();
  const uploaded = form?.get("file");
  if (!phone || !(uploaded instanceof File)) throw new ApiError(400, "validation_error", "Falta el teléfono o el archivo.");
  if (caption.length > 1000) throw new ApiError(400, "validation_error", "El texto del adjunto supera 1.000 caracteres.");
  const validationError = validateWhatsappAttachment(uploaded);
  if (validationError) throw new ApiError(400, "invalid_attachment", validationError);

  const identity = await resolveConversationIdentity(prisma, api.workspaceId, phone, null);
  const lastIn = await prisma.leadInboxMessage.findFirst({
    where: { ...conversationWhere(api.workspaceId, identity.phones, identity.leadIds), direction: "in" },
    orderBy: { receivedAt: "desc" },
    select: { instanceName: true, leadId: true, fromPhone: true, phoneNormalized: true, meta: true }
  });
  if (!lastIn) throw new ApiError(404, "no_conversation", "No hay conversación entrante con ese teléfono.");
  const meta: any = lastIn.meta ?? {};
  const originalChatId =
    (typeof meta?.payload?.from === "string" && meta.payload.from) ||
    (typeof meta?.from === "string" && meta.from) ||
    (lastIn.fromPhone && String(lastIn.fromPhone).includes("@") ? String(lastIn.fromPhone) : "") ||
    phone;
  const filename = uploaded.name.replace(/[\\/\0]/g, "_").slice(0, 180);
  let externalMessageId: string;
  try {
    const sent = await sendFile({
      workspaceId: api.workspaceId,
      phoneNormalized: originalChatId,
      file: Buffer.from(await uploaded.arrayBuffer()),
      filename,
      mimetype: uploaded.type,
      caption,
      session: lastIn.instanceName ?? undefined
    });
    externalMessageId = sent.messageId;
  } catch (error: any) {
    throw new ApiError(502, "send_failed", `No se pudo enviar el archivo: ${error?.message ?? error}`);
  }
  const replyIds = outgoingReplyIdentity(lastIn, phone);
  const body = formatWhatsappAttachmentBody(filename, caption);
  const saved = await prisma.leadInboxMessage.create({
    data: {
      workspaceId: api.workspaceId,
      leadId: lastIn.leadId,
      fromPhone: replyIds.fromPhone,
      phoneNormalized: replyIds.phoneNormalized,
      channel: "whatsapp",
      direction: "out",
      body,
      read: true,
      meta: { source: "human_file_reply", userId: api.userId ?? null, filename, mimetype: uploaded.type, size: uploaded.size },
      externalMessageId,
      instanceName: lastIn.instanceName
    }
  });
  return NextResponse.json({ ok: true, id: saved.id, body, at: saved.receivedAt.toISOString(), instanceName: lastIn.instanceName });
});
