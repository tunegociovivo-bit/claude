/**
 * GET /api/v1/admin/sonia-run/[id]
 *
 * Devuelve el log completo de un AiAgentRun para reproducción/debug
 * en /admin/sonia-dashboard. Solo runs del workspace del admin.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { params, api }) => {
  const id = String((params as any)?.id ?? "");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const run = await prisma.aiAgentRun.findFirst({
    where: { id, workspaceId: api.workspaceId }
  });
  if (!run) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  const task = await prisma.task.findFirst({
    where: { id: run.taskId, workspaceId: api.workspaceId },
    select: { id: true, title: true, client: { select: { name: true } } }
  });

  return NextResponse.json({
    id: run.id,
    taskId: run.taskId,
    task,
    status: run.status,
    trigger: run.trigger,
    triggerContext: run.triggerContext,
    model: run.model,
    summary: run.summary,
    error: run.error,
    log: run.log,
    stepsCount: run.stepsCount,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    lastIterationAt: run.lastIterationAt
  });
});
