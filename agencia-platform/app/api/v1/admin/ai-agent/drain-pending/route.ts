/**
 * POST /api/v1/admin/ai-agent/drain-pending
 *
 * Dispara processRunInBackground en TODOS los AiAgentRun PENDING
 * del workspace. Útil para "despertar" runs que se quedaron
 * encolados antes de que tuviéramos background trigger (ej: los
 * que el user encargó anoche y siguen PENDING esta mañana).
 *
 * Idempotente: si un run ya está RUNNING, processRunInBackground
 * lo skippea internamente (lock optimista en el UPDATE).
 *
 * Solo admin del workspace.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) {
    throw new ApiError(403, "forbidden", "Solo admin");
  }
  const pending = await prisma.aiAgentRun.findMany({
    where: { workspaceId: api.workspaceId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true, taskId: true, createdAt: true }
  });

  for (const r of pending) {
    processRunInBackground(r.id);
  }

  return NextResponse.json({
    ok: true,
    kicked: pending.length,
    runs: pending.map((r) => ({ id: r.id, taskId: r.taskId, createdAt: r.createdAt }))
  });
});
