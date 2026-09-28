import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";
import { parseCommentThreadMessage, serializeCommentThreadMessage } from "@/lib/mobile/comment-thread";

export const dynamic = "force-dynamic";

const schema = z.object({ threadId: z.string().uuid() }).strict();

/**
 * «Reactivar y continuar»: vuelve a poner en marcha todos los mensajes de una
 * conversación que se hayan quedado parados (pendientes de comprobar, fallidos,
 * abandonados o programados para más tarde). No interrumpe una ejecución activa.
 * Un envío incierto se conserva para verificarlo sin volver a publicarlo.
 */
export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Conversación no válida");
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const jobs = await tx.mobileAutomationJob.findMany({
      where: { workspaceId: api.workspaceId, action: "POST_THREAD_MESSAGE", idempotencyKey: { startsWith: `thread:${parsed.data.threadId}:` } },
      select: { id: true, status: true, deviceSerial: true, scheduledAt: true, leaseUntil: true, expiresAt: true, text: true }
    });
    if (!jobs.length) throw new ApiError(404, "thread_not_found", "La conversación ya no existe");
    let reactivated = 0;
    for (const job of jobs) {
      const stuck = job.status === "WAITING_USER" || job.status === "FAILED"
        || (job.status === "RUNNING" && (!job.leaseUntil || job.leaseUntil <= now))
        || (job.status === "QUEUED" && job.scheduledAt > now);
      if (!stuck) continue;
      const recoveryText = job.status === "RUNNING" ? serializeCommentThreadMessage({
        ...parseCommentThreadMessage(job.text ?? ""), outcome: "review", detail: "Ejecución interrumpida: verificar antes de volver a enviar."
      }) : null;
      await tx.mobileAutomationJob.update({
        where: { id: job.id },
        data: {
          status: "QUEUED", scheduledAt: now, attempts: 0, leaseOwner: null, leaseUntil: null,
          lastError: null, lastErrorCode: null,
          ...(recoveryText ? { text: recoveryText } : {}),
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        }
      });
      await tx.mobileAutomationJobEvent.create({
        data: { workspaceId: api.workspaceId, jobId: job.id, event: "THREAD_RESUMED", actorType: "USER", actorId: api.userId, metadata: { fromStatus: job.status } }
      });
      reactivated += 1;
    }
    const open = jobs.filter((job) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(job.status));
    return {
      reactivated,
      pendingApproval: jobs.filter((job) => job.status === "PENDING_APPROVAL").length,
      deviceSerials: [...new Set(open.map((job) => job.deviceSerial))]
    };
  }, { isolationLevel: "Serializable" });
  return NextResponse.json({ ok: true, ...result });
});
