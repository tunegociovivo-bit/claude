/**
 * Operaciones sobre un item concreto de la papelera. Solo ADMIN.
 *
 * POST   /api/v1/trash/[model]/[id]   → restaurar (deletedAt = null)
 * DELETE /api/v1/trash/[model]/[id]   → purgar definitivamente (HARD delete)
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { auditFromReq } from "@/lib/audit/log";
import type { TrashableModel } from "@/lib/trash";

const VALID = new Set<TrashableModel>(["task", "project", "document", "client"]);

function delegateFor(model: TrashableModel) {
  if (model === "task") return prisma.task;
  if (model === "project") return prisma.project;
  if (model === "document") return prisma.document;
  return prisma.client;
}

export const POST = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const model = params.model as TrashableModel;
  if (!VALID.has(model)) throw new ApiError(400, "invalid_model", "Modelo no válido");

  const updated = await (delegateFor(model) as any).updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: { not: null } },
    data: { deletedAt: null, deletedById: null }
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "No está en papelera");

  auditFromReq(req, api, {
    action: `${model}.restore`,
    targetType: model.toUpperCase(),
    targetId: params.id
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const model = params.model as TrashableModel;
  if (!VALID.has(model)) throw new ApiError(400, "invalid_model", "Modelo no válido");

  // Hard delete — definitivo. Solo se permite si ya estaba soft-deleted
  // (deletedAt != null) para evitar accidentes desde la UI.
  const del = await (delegateFor(model) as any).deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: { not: null } }
  });
  if (del.count === 0) throw new ApiError(404, "not_found", "No está en papelera o ya fue purgado");

  auditFromReq(req, api, {
    action: `${model}.purge`,
    targetType: model.toUpperCase(),
    targetId: params.id,
    meta: { hard: true }
  });
  return NextResponse.json({ ok: true });
});
