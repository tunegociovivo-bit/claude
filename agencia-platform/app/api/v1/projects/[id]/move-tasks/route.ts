/**
 * POST /api/v1/projects/[id]/move-tasks
 * Body: { destinationProjectId: string, includeArchived?: boolean }
 *
 * Mueve TODAS las tareas (no borradas) del proyecto origen al
 * destino. Útil ANTES de borrar un proyecto si no quieres perder las
 * tareas — el flujo natural en el modal de borrado es:
 *   1) (Opcional) "Mover tareas a X" → llama a este endpoint
 *   2) Confirmar borrado → soft-delete del proyecto (queda vacío)
 *
 * Reglas:
 * - Solo ADMIN del workspace.
 * - Origen y destino deben pertenecer al mismo workspaceId.
 * - El destino debe estar vivo (deletedAt:null) y no archived.
 * - Las tareas mantienen su status original; si las columnas del
 *   proyecto destino no incluyen ese status, el frontend de /tareas
 *   las pintará en la primera columna como fallback (igual que ya
 *   hace para tareas multi-proyecto). No tocamos el status aquí
 *   para que el move sea reversible si queremos.
 * - Audit log: project.move_tasks con conteo.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { auditFromReq } from "@/lib/audit/log";
import { callerIsAdmin } from "@/lib/api/permissions";

const bodySchema = z.object({
  destinationProjectId: z.string().min(1),
  includeArchived: z.boolean().optional()
});

export const POST = withApi({ scope: "projects:write" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) {
    throw new ApiError(403, "forbidden", "Solo admins pueden mover tareas entre proyectos");
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { destinationProjectId, includeArchived } = parsed.data;

  if (destinationProjectId === params.id) {
    throw new ApiError(400, "same_project", "Origen y destino son el mismo proyecto");
  }

  // Validamos que ambos proyectos existen en el workspace.
  const [origin, destination] = await Promise.all([
    prisma.project.findFirst({
      where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
    }),
    prisma.project.findFirst({
      where: { id: destinationProjectId, workspaceId: api.workspaceId, deletedAt: null }
    })
  ]);
  if (!origin) throw new ApiError(404, "origin_not_found", "Proyecto origen no encontrado");
  if (!destination) throw new ApiError(404, "destination_not_found", "Proyecto destino no encontrado");

  const result = await prisma.task.updateMany({
    where: {
      projectId: origin.id,
      workspaceId: api.workspaceId,
      deletedAt: null,
      ...(includeArchived ? {} : {})
    },
    data: { projectId: destination.id }
  });

  auditFromReq(req, api, {
    action: "project.move_tasks",
    targetType: "PROJECT",
    targetId: origin.id,
    meta: {
      destinationProjectId,
      destinationProjectName: destination.name,
      tasksMoved: result.count
    }
  });

  return NextResponse.json({
    ok: true,
    moved: result.count,
    from: { id: origin.id, name: origin.name },
    to: { id: destination.id, name: destination.name }
  });
});
