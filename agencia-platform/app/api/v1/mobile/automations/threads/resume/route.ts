import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";
import { reactivateThreadJobs } from "@/lib/mobile/thread-resume";

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
      select: { id: true, status: true, deviceSerial: true, scheduledAt: true, leaseUntil: true, expiresAt: true, text: true, lastErrorCode: true }
    });
    if (!jobs.length) throw new ApiError(404, "thread_not_found", "La conversación ya no existe");
    const reactivated = await reactivateThreadJobs(tx, {
      workspaceId: api.workspaceId, jobs, now, includeScheduled: true,
      actorType: "USER", actorId: api.userId, event: "THREAD_RESUMED"
    });
    const open = jobs.filter((job) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(job.status) || job.lastErrorCode === "expired");
    return {
      reactivated,
      pendingApproval: jobs.filter((job) => job.status === "PENDING_APPROVAL").length,
      deviceSerials: [...new Set(open.map((job) => job.deviceSerial))]
    };
  }, { isolationLevel: "Serializable" });
  return NextResponse.json({ ok: true, ...result });
});
