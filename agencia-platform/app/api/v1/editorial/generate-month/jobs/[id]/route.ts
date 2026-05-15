/**
 * GET /api/v1/editorial/generate-month/jobs/[id]
 * Devuelve el estado actual de un job de generación.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const job = await prisma.backgroundJob.findFirst({
    where: {
      id: params.id,
      workspaceId: api.workspaceId,
      kind: "editorial.generate_month"
    }
  });
  if (!job) throw new ApiError(404, "not_found", "Job no encontrado");
  return NextResponse.json({
    id: job.id,
    status: job.status,
    progressPct: job.progressPct,
    progressMsg: job.progressMsg,
    result: job.result,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt
  });
});
