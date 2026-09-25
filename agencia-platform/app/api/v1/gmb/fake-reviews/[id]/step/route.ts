/**
 * POST /api/v1/gmb/fake-reviews/[id]/step {resume?} → avanza el análisis ~20 s y devuelve el progreso.
 * `resume: true` reintenta un análisis en error desde donde se quedó.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { runAnalysisJob } from "@/lib/gmb/fake-reviews/job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const found = await prisma.gmbFakeReviewAnalysis.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true, status: true } });
  if (!found) throw new ApiError(404, "not_found", "Análisis no encontrado");
  if (body?.resume && found.status === "error") {
    await prisma.gmbFakeReviewAnalysis.updateMany({
      where: { id: found.id, workspaceId: api.workspaceId },
      data: { status: "running", lastError: null, lockedUntil: null }
    });
  }
  const row = await runAnalysisJob(api.workspaceId, found.id, 20_000);
  if (!row) throw new ApiError(404, "not_found", "Análisis no encontrado");
  return NextResponse.json({
    status: row.status,
    progress: row.progress,
    step: row.stepLabel,
    calls: row.apiCalls,
    error: row.lastError
  });
});
