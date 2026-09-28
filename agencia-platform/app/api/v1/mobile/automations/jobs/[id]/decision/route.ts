import { parseCommentThreadMessage, sameThreadSlot, serializeCommentThreadMessage } from "@/lib/mobile/comment-thread";
import { MAX_CONVERSATION_BATCH_TEXT, parseConversationBatch, serializeConversationBatch, validateConversationApproval } from "@/lib/mobile/facebook-conversations";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";
import {
  canTransitionMobileAutomation,
  validateAutomationTargetUrl,
  type MobileAutomationPlatform,
  type MobileAutomationStatus,
  type MobileAutomationTransition
} from "@/lib/mobile/automation-policy";
import {
  MAX_FACEBOOK_GROUP_BATCH_TEXT,
  parseFacebookGroupBatch,
  selectedFacebookGroupCount
} from "@/lib/mobile/facebook-group-batch";

const decisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "COMPLETE", "RETRY", "VERIFY", "CANCEL"]),
  verifiedPublished: z.boolean().optional(),
  text: z.string().trim().min(1).max(MAX_CONVERSATION_BATCH_TEXT).optional(),
  targetUrl: z.string().trim().min(1).max(2048).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional()
}).strict();

const statusByAction: Record<string, string> = {
  APPROVE: "QUEUED",
  REJECT: "REJECTED",
  COMPLETE: "COMPLETED",
  RETRY: "QUEUED",
  VERIFY: "QUEUED",
  CANCEL: "CANCELLED"
};

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Decisión no válida");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const job = await tx.mobileAutomationJob.findFirst({
      where: { id: params.id, workspaceId: api.workspaceId }
    });
    if (!job) throw new ApiError(404, "job_not_found", "El trabajo ya no existe");
    if (parsed.data.action === "VERIFY") {
      if (job.action !== "POST_THREAD_MESSAGE" || !job.approvedAt || !["QUEUED", "FAILED", "WAITING_USER"].includes(job.status)
        || parsed.data.text || parsed.data.targetUrl || parsed.data.scheduledAt || parsed.data.verifiedPublished !== undefined) {
        throw new ApiError(409, "invalid_transition", "Solo se pueden verificar mensajes aprobados que no estén ejecutándose.");
      }
      const original = parseCommentThreadMessage(job.text ?? "");
      const data = {
        status: "QUEUED", scheduledAt: new Date(), attempts: 0, leaseOwner: null, leaseUntil: null,
        lastError: null, lastErrorCode: null,
        text: serializeCommentThreadMessage({ ...original, sendProtocol: "checkpoint-v1", outcome: "review", detail: "Comprobación automática de la publicación; no se volverá a enviar." })
      };
      const changed = await tx.mobileAutomationJob.updateMany({ where: { id: job.id, workspaceId: api.workspaceId, status: job.status, text: job.text }, data });
      if (changed.count !== 1) throw new ApiError(409, "state_changed", "El trabajo ya cambió de estado; actualiza la lista");
      await tx.mobileAutomationJobEvent.create({ data: { workspaceId: api.workspaceId, jobId: job.id, event: "VERIFY_REQUESTED", actorType: "USER", actorId: api.userId } });
      return { ...job, ...data };
    }
    const transition = parsed.data.action as MobileAutomationTransition;
    const threadManualConfirm = job.action === "POST_THREAD_MESSAGE" && transition === "COMPLETE"
      && (job.status === "FAILED" || (job.status === "QUEUED" && Boolean(job.approvedAt) && parsed.data.verifiedPublished === true));
    if (!threadManualConfirm && !canTransitionMobileAutomation(job.status as MobileAutomationStatus, transition)) {
      throw new ApiError(409, "invalid_transition", "El trabajo ya cambió de estado; actualiza la lista");
    }

    const now = new Date();
    const targetUrl = validateAutomationTargetUrl(
      job.platform as MobileAutomationPlatform,
      parsed.data.targetUrl ?? job.targetUrl ?? ""
    );
    let text = (parsed.data.text ?? job.text ?? "").trim();
    if (!text) throw new ApiError(400, "missing_text", "El borrador no contiene texto");
    if (["APPROVE", "RETRY"].includes(parsed.data.action) && job.action === "JOIN_FACEBOOK_GROUP_BATCH") {
      let batch;
      try {
        batch = parseFacebookGroupBatch(text);
      } catch {
        throw new ApiError(400, "invalid_group_batch", "El lote de grupos no es válido");
      }
      if (parsed.data.action === "APPROVE" && selectedFacebookGroupCount(batch) === 0) {
        throw new ApiError(400, "empty_group_batch", "Selecciona al menos un grupo antes de aprobar el lote");
      }
    }
    if (["APPROVE", "RETRY"].includes(parsed.data.action) && job.action === "REPLY_FACEBOOK_CONVERSATIONS") {
      try { text = serializeConversationBatch(validateConversationApproval(parseConversationBatch(job.text ?? ""), parseConversationBatch(text))); }
      catch (error) { throw new ApiError(400, "invalid_conversation_batch", error instanceof Error ? error.message : "Lote no válido"); }
    }
    if (parsed.data.action === "APPROVE" && job.action === "POST_THREAD_MESSAGE") {
      try {
        const original = parseCommentThreadMessage(job.text ?? "");
        const edited = parseCommentThreadMessage(text);
        if (!sameThreadSlot(original, edited)) throw new Error("Solo se puede cambiar el texto del mensaje.");
        text = serializeCommentThreadMessage({ ...original, text: edited.text });
      } catch (error) {
        throw new ApiError(400, "invalid_thread_message", error instanceof Error ? error.message : "Mensaje no válido");
      }
    }
    const data: Record<string, unknown> = {
      status: statusByAction[parsed.data.action],
      leaseOwner: null,
      leaseUntil: null
    };
    if (parsed.data.action === "APPROVE") {
      data.text = text;
      data.targetUrl = targetUrl;
      data.scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : job.scheduledAt;
      data.approvedAt = now;
      data.approvedById = api.userId;
    } else if (parsed.data.action === "COMPLETE") {
      data.completedAt = now;
      data.lastError = null;
      data.lastErrorCode = null;
    } else if (parsed.data.action === "RETRY") {
      data.scheduledAt = now;
      data.lastError = null;
      data.lastErrorCode = null;
      if (["JOIN_FACEBOOK_GROUP_BATCH", "REPLY_FACEBOOK_CONVERSATIONS"].includes(job.action)) data.text = text;
      // FOLLOW_PAGES conserva el lote del servidor: el reintento solo repite las páginas pendientes o fallidas.
    }

    const changed = await tx.mobileAutomationJob.updateMany({
      where: { id: job.id, workspaceId: api.workspaceId, status: job.status },
      data
    });
    if (changed.count !== 1) {
      throw new ApiError(409, "state_changed", "El trabajo ya cambió de estado; actualiza la lista");
    }
    await tx.mobileAutomationJobEvent.create({
      data: {
        workspaceId: api.workspaceId,
        jobId: job.id,
        event: parsed.data.action === "APPROVE" ? "APPROVED" : parsed.data.action,
        actorType: "USER",
        actorId: api.userId,
        metadata: { fromStatus: job.status, toStatus: statusByAction[parsed.data.action], ...(parsed.data.verifiedPublished === true ? { verifiedPublished: true } : {}) }
      }
    });
    return { ...job, ...data };
  }, { isolationLevel: "Serializable" });
  return NextResponse.json({ ok: true, job: updated });
});
