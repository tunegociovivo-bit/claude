/**
 * GET /api/v1/sonia/voice-inbox
 *
 * Devuelve la última llamada entrante (trigger CALL_INBOUND) que Sonia
 * ya ha procesado y para la que tiene acciones PENDIENTES que puede
 * ejecutar (AiDraft en estado PENDING). Es lo que el notificador de voz
 * usa para avisar "he procesado la llamada de X, puedo hacer esto y esto".
 *
 * Solo admin (es el dueño quien recibe el aviso por voz).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

const LOOKBACK_MS = 30 * 60 * 1000;

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");

  const since = new Date(Date.now() - LOOKBACK_MS);
  const run = await prisma.aiAgentRun.findFirst({
    where: {
      workspaceId: api.workspaceId,
      trigger: "CALL_INBOUND",
      status: { in: ["SUCCEEDED", "REQUIRES_HUMAN"] },
      finishedAt: { gte: since }
    },
    orderBy: { finishedAt: "desc" },
    select: { id: true, taskId: true, summary: true, finishedAt: true }
  });
  if (!run) return NextResponse.json({ pending: null });

  const drafts = await prisma.aiDraft.findMany({
    where: { workspaceId: api.workspaceId, aiAgentRunId: run.id, status: "PENDING" },
    select: { id: true, title: true, kind: true },
    orderBy: { createdAt: "asc" }
  });
  if (drafts.length === 0) return NextResponse.json({ pending: null });

  const task = await prisma.task.findFirst({
    where: { id: run.taskId, workspaceId: api.workspaceId },
    select: { title: true }
  });

  return NextResponse.json({
    pending: {
      runId: run.id,
      taskId: run.taskId,
      taskTitle: task?.title ?? null,
      summary: run.summary ?? null,
      finishedAt: run.finishedAt,
      drafts
    }
  });
});
