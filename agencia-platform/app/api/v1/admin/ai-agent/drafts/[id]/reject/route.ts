/**
 * POST /api/v1/admin/ai-agent/drafts/:id/reject
 * body opcional: { note?: string }
 *
 * Marca el draft como REJECTED. No se ejecuta. La nota queda
 * registrada — útil si en el futuro queremos retroalimentar a la IA
 * con "por qué rechazaste sus drafts" para que aprenda criterios.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ note: z.string().max(2000).optional() });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const draft = await prisma.aiDraft.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!draft) throw new ApiError(404, "not_found", "Draft no encontrado");
  if (draft.status === "EXECUTED") {
    throw new ApiError(400, "already_executed", "Ya se ejecutó — no se puede rechazar");
  }

  const updated = await prisma.aiDraft.update({
    where: { id: params.id },
    data: {
      status: "REJECTED",
      reviewedById: api.userId,
      reviewedAt: new Date(),
      reviewerNote: parsed.data.note ?? null
    }
  });
  return NextResponse.json({ ok: true, draft: updated });
});
