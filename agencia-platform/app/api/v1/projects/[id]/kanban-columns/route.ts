/**
 * Columnas Kanban POR PROYECTO.
 *
 * GET → devuelve las columnas propias del proyecto. Si el proyecto
 *       no tiene columnas custom, devuelve las del workspace como
 *       fallback (mismo shape).
 * PUT → reemplaza el array completo de columnas del proyecto (en
 *       Project.kanbanColumns Json). NO toca las del workspace ni las
 *       de otros proyectos — cada proyecto es independiente.
 *
 * Bug fix: hasta hoy todas las ediciones (rename, add, delete) iban
 * a /api/v1/kanban-columns que es WORKSPACE-level, por eso cambiaban
 * en todos los proyectos. Este endpoint las aísla.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { readKanbanColumns } from "@/lib/kanban";

const columnSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  color: z.string().max(400).optional().nullable(),
  // order tolerante: acepta number o string numérico
  order: z.coerce.number().int().min(0).max(999),
  isDone: z.boolean().optional()
}).passthrough(); // permite campos extra sin fallar

const updateSchema = z.object({
  // Cap subido de 20 a 50 — proyectos importados de Asana con muchas
  // secciones podían tener >20 columnas y la validación fallaba.
  columns: z.array(columnSchema).min(1).max(50)
});

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const proj = await prisma.project.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null } as any,
    select: { kanbanColumns: true }
  });
  if (!proj) throw new ApiError(404, "not_found", "Proyecto no encontrado");
  const ownCols = proj.kanbanColumns as any;
  if (Array.isArray(ownCols) && ownCols.length > 0) {
    return NextResponse.json({ items: ownCols, source: "project" });
  }
  // Fallback: columnas del workspace
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  return NextResponse.json({
    items: readKanbanColumns((ws?.settings as any) ?? {}),
    source: "workspace_fallback"
  });
});

export const PUT = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  // No exigimos ADMIN — cualquier user con acceso al proyecto puede
  // tunear su tablero. Si quieres restringir, el filtro de membership
  // de proyecto ya lo controla a nivel de acceso al proyecto entero.
  const proj = await prisma.project.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null } as any,
    select: { id: true }
  });
  if (!proj) throw new ApiError(404, "not_found", "Proyecto no encontrado");

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ids = new Set(parsed.data.columns.map((c) => c.id));
  if (ids.size !== parsed.data.columns.length) {
    throw new ApiError(400, "duplicate_id", "IDs duplicados");
  }

  await prisma.project.update({
    where: { id: params.id },
    data: { kanbanColumns: parsed.data.columns as any }
  });
  return NextResponse.json({ ok: true, items: parsed.data.columns });
});
