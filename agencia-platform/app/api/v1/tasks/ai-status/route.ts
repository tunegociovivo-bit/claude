/**
 * GET /api/v1/tasks/ai-status?taskIds=id1,id2,id3
 *
 * Devuelve, para cada taskId, el último AiAgentRun (status + si está
 * pendiente de revisión humana) Y datos enriquecidos para mostrar
 * en UI un badge informativo:
 *   - aiStatus: "working" | "done_unreviewed" | "needs_help" | null
 *   - startedAt: cuándo arrancó (para "🤖 Trabajando 2m 14s")
 *   - finishedAt: cuándo terminó (para "✓ Lista hace 3m")
 *   - summary: resumen de éxito (50 primeros chars)
 *   - error: motivo de fallo (50 primeros chars)
 *   - stepsCount: cuántos pasos ejecutó
 *   - runId: para acciones tipo "marcar revisado"
 *
 * Mantenemos response ligera para que sea pollable cada N segundos
 * por la UI sin coste apreciable.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "tasks:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get("taskIds") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (ids.length === 0) return NextResponse.json({ items: [] });

  const runs = await prisma.aiAgentRun.findMany({
    where: { workspaceId: api.workspaceId, taskId: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      taskId: true,
      status: true,
      humanReviewedAt: true,
      summary: true,
      error: true,
      stepsCount: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      updatedAt: true
    }
  });

  const latestByTask = new Map<string, typeof runs[number]>();
  for (const r of runs) {
    if (!latestByTask.has(r.taskId)) latestByTask.set(r.taskId, r);
  }

  const items = ids.map((id) => {
    const r = latestByTask.get(id);
    if (!r) return { taskId: id, aiStatus: null };
    let visual: "working" | "done_unreviewed" | "needs_help" | null = null;
    if (r.status === "PENDING" || r.status === "RUNNING") visual = "working";
    else if (r.status === "SUCCEEDED" && !r.humanReviewedAt) visual = "done_unreviewed";
    else if (r.status === "REQUIRES_HUMAN" && !r.humanReviewedAt) visual = "needs_help";
    return {
      taskId: id,
      aiStatus: visual,
      runId: r.id,
      runStatus: r.status,
      // ISOs — el cliente calcula "hace 2m" localmente.
      startedAt: (r.startedAt ?? r.createdAt).toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      summary: r.summary ? r.summary.slice(0, 140) : null,
      error: r.error ? r.error.slice(0, 140) : null,
      stepsCount: r.stepsCount,
      reviewed: !!r.humanReviewedAt
    };
  });

  return NextResponse.json({ items });
});
