/**
 * Endpoints de gestión de drafts de NV IA (aprobación humana).
 *
 * GET    /api/v1/admin/ai-agent/drafts          — lista (filtros por status, kind, limit)
 * POST   /api/v1/admin/ai-agent/drafts/:id/approve — aprobar + ejecutar
 * POST   /api/v1/admin/ai-agent/drafts/:id/reject  — rechazar con nota
 *
 * Solo admin del workspace.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const kind = url.searchParams.get("kind") ?? undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const items = await prisma.aiDraft.findMany({
    where: {
      workspaceId: api.workspaceId,
      ...(status ? { status: status as any } : {}),
      ...(kind ? { kind: kind as any } : {})
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      title: true,
      payload: true,
      status: true,
      reviewedAt: true,
      reviewerNote: true,
      executedAt: true,
      executionResult: true,
      createdAt: true,
      taskId: true,
      aiAgentRunId: true
    }
  });
  return NextResponse.json({ items });
});
