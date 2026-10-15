import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", admin: true }, async (_req, { api, params }) => {
  const id = String(params?.id || "");
  const job = await prisma.instagramProspectorJob.findFirst({
    where: { id, workspaceId: api.workspaceId },
    select: { id: true, status: true, config: true, result: true, error: true, claimedByAgentKey: true, createdAt: true, startedAt: true, finishedAt: true }
  });
  if (!job) throw new ApiError(404, "not_found", "Busqueda de Instagram no encontrada");
  const result = job.result && typeof job.result === "object" && !Array.isArray(job.result) ? job.result : null;
  if (!result) return NextResponse.json(job);
  const { candidates, ...publicResult } = result;
  return NextResponse.json({ ...job, result: { ...publicResult, candidateCount: Array.isArray(candidates) ? candidates.length : 0 } });
});
