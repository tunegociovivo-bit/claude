/**
 * GET    /api/v1/gmb/fake-reviews/[id] → análisis completo (resultados incluidos)
 * DELETE /api/v1/gmb/fake-reviews/[id] → borra el análisis
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const row = await prisma.gmbFakeReviewAnalysis.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: {
      id: true, clientId: true, clientName: true, label: true, status: true, progress: true, stepLabel: true,
      apiCalls: true, lastError: true, results: true, createdAt: true, finishedAt: true, shareExpiresAt: true, shareTokenHash: true
    }
  });
  if (!row) throw new ApiError(404, "not_found", "Análisis no encontrado");
  const { shareTokenHash, ...rest } = row;
  return NextResponse.json({ analysis: { ...rest, shared: !!shareTokenHash && !!row.shareExpiresAt && row.shareExpiresAt > new Date() } });
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { params, api }) => {
  const r = await prisma.gmbFakeReviewAnalysis.deleteMany({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!r.count) throw new ApiError(404, "not_found", "Análisis no encontrado");
  return NextResponse.json({ ok: true });
});
