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

// IDs de columna: permitimos cualquier string razonable (1-60 chars)
// para no rechazar IDs ya existentes de imports antiguos que no
// matchean la convención MAYÚSCULAS_CON_GUIONES_BAJOS. La UI sigue
// generando IDs limpios via slugify, pero la API NO debe rechazar
// lo que ya está en BD — eso bloqueaba cambios cosméticos (color,
// label) en proyectos importados de Asana donde algún ID tenía
// chars fuera del set estricto.
const columnSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(60),
  color: z.string().max(200).optional(),
  // order tolerante: acepta number o string numérico y normalizamos
  // a number en el bucle. Algunos imports antiguos guardaron order
  // como string.
  order: z.coerce.number().int().min(0).max(99),
  isDone: z.boolean().optional()
});

const updateSchema = z.object({
  columns: z.array(columnSchema).min(1).max(20)
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
