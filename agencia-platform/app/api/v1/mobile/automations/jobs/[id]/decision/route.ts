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

const decisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "COMPLETE", "RETRY", "CANCEL"]),
  text: z.string().trim().min(1).max(4000).optional(),
  targetUrl: z.string().trim().min(1).max(2048).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional()
}).strict();

const statusByAction: Record<string, string> = {
  APPROVE: "QUEUED",
  REJECT: "REJECTED",
  COMPLETE: "COMPLETED",
  RETRY: "QUEUED",
  CANCEL: "CANCELLED"
};

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Decisión no válida");
  }
  const job = await prisma.mobileAutomationJob.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!job) throw new ApiError(404, "job_not_found", "El trabajo ya no existe");
  const transition = parsed.data.action as MobileAutomationTransition;
  if (!canTransitionMobileAutomation(job.status as MobileAutomationStatus, transition)) {
    throw new ApiError(409, "invalid_transition", "El trabajo ya cambió de estado; actualiza la lista");
  }

  const now = new Date();
  const targetUrl = validateAutomationTargetUrl(
    job.platform as MobileAutomationPlatform,
    parsed.data.targetUrl ?? job.targetUrl ?? ""
  );
  const text = (parsed.data.text ?? job.text ?? "").trim();
  if (!text) throw new ApiError(400, "missing_text", "El borrador no contiene texto");
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
  } else if (parsed.data.action === "RETRY") {
    data.scheduledAt = now;
    data.lastError = null;
    data.lastErrorCode = null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.mobileAutomationJob.update({ where: { id: job.id }, data });
    await tx.mobileAutomationJobEvent.create({
      data: {
        workspaceId: api.workspaceId,
        jobId: job.id,
        event: parsed.data.action === "APPROVE" ? "APPROVED" : parsed.data.action,
        actorType: "USER",
        actorId: api.userId,
        metadata: { fromStatus: job.status, toStatus: statusByAction[parsed.data.action] }
      }
    });
    return next;
  });
  return NextResponse.json({ ok: true, job: updated });
});

