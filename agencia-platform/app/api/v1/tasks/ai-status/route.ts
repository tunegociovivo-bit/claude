/**
 * GET /api/v1/tasks/ai-status?taskIds=id1,id2,id3
 *
 * Devuelve, para cada taskId, el último AiAgentRun (status + si está
 * pendiente de revisión humana). Usado por el cliente de /tareas
 * para pintar el borde parpadeante en las tarjetas:
 *   - morado: hay run RUNNING o PENDING (Sonia trabajando)
 *   - verde:  último run SUCCEEDED sin humanReviewedAt
 *   - naranja: último run REQUIRES_HUMAN sin humanReviewedAt
 *   - null:   nada activo / ya revisado
 *
 * Solo devuelve estados de tasks DEL workspace del caller — los ids
 * de otro workspace simplemente no aparecen en la respuesta.
 *
 * Mantenemos response ultra-ligera para que sea pollable cada N segundos
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

  // Para cada task, el último AiAgentRun. Hacemos una query por la
  // tabla entera filtrando por workspaceId + taskId IN, ordenamos por
  // createdAt desc, y en cliente reducimos a "el primero por taskId".
  // Más eficiente que N queries.
  const runs = await prisma.aiAgentRun.findMany({
    where: { workspaceId: api.workspaceId, taskId: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: {
      taskId: true,
      status: true,
      humanReviewedAt: true,
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
    // Visual state simplificado para el cliente
    let visual: "working" | "done_unreviewed" | "needs_help" | null = null;
    if (r.status === "PENDING" || r.status === "RUNNING") visual = "working";
    else if (r.status === "SUCCEEDED" && !r.humanReviewedAt) visual = "done_unreviewed";
    else if (r.status === "REQUIRES_HUMAN" && !r.humanReviewedAt) visual = "needs_help";
    return {
      taskId: id,
      aiStatus: visual,
      raw: { status: r.status, reviewed: !!r.humanReviewedAt, updatedAt: r.updatedAt }
    };
  });

  return NextResponse.json({ items });
});
