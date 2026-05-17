/**
 * POST /api/v1/admin/ai-agent/drafts/:id/approve
 *
 * Aprueba un draft y lo ejecuta. La aprobación + ejecución son una
 * sola operación atómica desde el punto de vista del user: si la
 * ejecución falla, el draft queda en status FAILED con el error
 * registrado en executionResult — el admin puede reintentar.
 *
 * Solo admin.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { executeDraft } from "@/lib/ai/nv-ia/execute-draft";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "destructive" }, async (_req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const draft = await prisma.aiDraft.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!draft) throw new ApiError(404, "not_found", "Draft no encontrado");
  if (draft.status === "EXECUTED") {
    return NextResponse.json({ ok: true, alreadyExecuted: true });
  }
  if (draft.status === "REJECTED") {
    throw new ApiError(400, "rejected", "Este draft ya fue rechazado");
  }
  // Lock optimista — solo aprobamos si está en PENDING o FAILED (retry).
  const claimed = await prisma.aiDraft.updateMany({
    where: { id: params.id, status: { in: ["PENDING", "FAILED"] } },
    data: {
      status: "APPROVED",
      reviewedById: api.userId,
      reviewedAt: new Date()
    }
  });
  if (claimed.count === 0) {
    throw new ApiError(409, "race", "El draft cambió de estado mientras lo aprobabas. Refresca.");
  }
  const result = await executeDraft(params.id);
  const updated = await prisma.aiDraft.findUnique({ where: { id: params.id } });
  return NextResponse.json({ ok: result.ok, executionResult: result, draft: updated });
});
