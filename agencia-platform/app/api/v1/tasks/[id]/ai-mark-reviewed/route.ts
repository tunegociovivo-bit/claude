/**
 * POST /api/v1/tasks/:id/ai-mark-reviewed
 *
 * Marca como "revisado por humano" TODOS los AiAgentRun de esta task
 * que aún están sin humanReviewedAt. Apaga el parpadeo verde/naranja
 * en el tablón. Idempotente.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "tasks:write" }, async (_req, { params, api }) => {
  // Verificación de pertenencia al workspace — sin esto un user podría
  // intentar mark-reviewed en una task ajena.
  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");
  const r = await prisma.aiAgentRun.updateMany({
    where: {
      taskId: params.id,
      workspaceId: api.workspaceId,
      humanReviewedAt: null,
      status: { in: ["SUCCEEDED", "REQUIRES_HUMAN", "FAILED"] }
    },
    data: { humanReviewedAt: new Date() }
  });
  return NextResponse.json({ ok: true, marked: r.count });
});
