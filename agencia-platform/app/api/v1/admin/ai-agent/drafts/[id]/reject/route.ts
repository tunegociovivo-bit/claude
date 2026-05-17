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
import { appendClientMemoryNote } from "@/lib/ai/nv-ia/client-memory";

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

  // Auto-feedback: si el draft tenía una task con cliente Y hubo
  // nota de rechazo, la añadimos a la memoria del cliente. Así la
  // IA aprende del rechazo automáticamente — no tiene que hacer
  // nada para empezar a recordar "no le mandes esto en este tono".
  if (parsed.data.note && draft.taskId) {
    try {
      const task = await prisma.task.findFirst({
        where: { id: draft.taskId, workspaceId: api.workspaceId },
        select: { clientId: true, title: true }
      });
      if (task?.clientId) {
        await appendClientMemoryNote({
          workspaceId: api.workspaceId,
          clientId: task.clientId,
          note: `Sobre "${draft.title.slice(0, 80)}" → ${parsed.data.note}`,
          type: "rejected_draft",
          by: api.userId ? `user:${api.userId}` : "admin"
        });
      }
    } catch (e) {
      console.warn("[nv-ia memory] append on reject failed:", (e as Error).message);
    }
  }

  return NextResponse.json({ ok: true, draft: updated });
});
