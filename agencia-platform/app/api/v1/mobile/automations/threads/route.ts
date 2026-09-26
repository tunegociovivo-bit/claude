import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { loadMobileAutomationAccess, requireLinkedMobile } from "@/lib/mobile/automation-access";
import { validateAutomationTargetUrl } from "@/lib/mobile/automation-policy";
import {
  MAX_THREAD_MESSAGES,
  MAX_THREAD_PARTICIPANTS,
  serializeCommentThreadMessage,
  simulatedMessageSchema,
  threadParticipantSchema,
  validateThreadScript
} from "@/lib/mobile/comment-thread";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  threadId: z.string().uuid(),
  postUrl: z.string().trim().min(1).max(2048),
  guide: z.string().trim().min(1).max(2000),
  participants: z.array(threadParticipantSchema).min(2).max(MAX_THREAD_PARTICIPANTS),
  messages: z.array(simulatedMessageSchema).min(2).max(MAX_THREAD_MESSAGES),
  startAt: z.string().datetime({ offset: true }).optional(),
  gapMinutes: z.number().int().min(1).max(240).default(8)
}).strict();

/**
 * Crea un trabajo por mensaje en la cola del móvil que lo publicará.
 * Todos quedan en PENDING_APPROVAL: nada se publica sin la aprobación del mensaje.
 */
export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Conversación no válida");
  const { threadId, guide, participants, messages, gapMinutes } = parsed.data;
  let postUrl: string;
  try { postUrl = validateAutomationTargetUrl("facebook", parsed.data.postUrl); }
  catch (error) { throw new ApiError(400, "invalid_url", error instanceof Error ? error.message : "URL no válida"); }
  try { validateThreadScript(messages, participants.length); }
  catch (error) { throw new ApiError(400, "invalid_thread", error instanceof Error ? error.message : "Guion no válido"); }
  for (const participant of participants) requireLinkedMobile(phones, participant.phoneKey, participant.deviceSerial);

  const existing = await prisma.mobileAutomationJob.findMany({
    where: { workspaceId: api.workspaceId, idempotencyKey: { startsWith: `thread:${threadId}:` } },
    orderBy: { createdAt: "asc" }
  });
  if (existing.length) return NextResponse.json({ ok: true, jobs: existing, replayed: true });

  const start = parsed.data.startAt ? new Date(parsed.data.startAt) : new Date();
  const jobs = await prisma.$transaction(async (tx) => {
    const created: Array<{ id: string }> = [];
    for (const message of messages) {
      const participant = participants[message.participant]!;
      const parent = message.replyToOrder ? messages[message.replyToOrder - 1]! : null;
      const scheduledAt = new Date(start.getTime() + (message.order - 1) * gapMinutes * 60_000);
      const job = await tx.mobileAutomationJob.create({
        data: {
          workspaceId: api.workspaceId,
          phoneKey: participant.phoneKey,
          deviceSerial: participant.deviceSerial,
          platform: "facebook",
          action: "POST_THREAD_MESSAGE",
          sourceKind: "COMMENT_THREAD",
          sourceRef: `Conversación ${message.order}/${messages.length} · ${guide.slice(0, 120)}`,
          targetUrl: postUrl,
          facts: participant.facts || null,
          text: serializeCommentThreadMessage({
            kind: "comment_thread",
            version: 1,
            threadId,
            order: message.order,
            total: messages.length,
            postUrl,
            guide: guide.slice(0, 2000),
            author: participant.label,
            mode: message.mode,
            replyToOrder: message.replyToOrder,
            replyToAuthor: parent ? participants[parent.participant]!.label : null,
            replyToText: parent ? parent.text : null,
            parentJobId: parent ? created[parent.order - 1]!.id : null,
            previousJobId: created.at(-1)?.id ?? null,
            text: message.text,
            outcome: "pending",
            detail: null
          }),
          status: "PENDING_APPROVAL",
          scheduledAt,
          expiresAt: new Date(scheduledAt.getTime() + 7 * 24 * 60 * 60 * 1000),
          maxAttempts: 2,
          idempotencyKey: `thread:${threadId}:${message.order}`,
          createdById: api.userId
        }
      });
      await tx.mobileAutomationJobEvent.create({
        data: {
          workspaceId: api.workspaceId, jobId: job.id, event: "DRAFT_CREATED", actorType: "USER", actorId: api.userId,
          metadata: { sourceKind: "COMMENT_THREAD", threadId, order: message.order }
        }
      });
      created.push(job);
    }
    return created;
  });
  return NextResponse.json({ ok: true, jobs }, { status: 201 });
});
