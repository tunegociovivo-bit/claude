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
  columns: z.array(columnSchema).min(1).max(50),
  // Migraciones obligatorias si al quitar una columna hay tasks
  // asignadas a ella. Mapa "oldColumnId" → "newColumnId" (debe existir
  // en `columns`). Sin esto, el endpoint rechaza el delete para evitar
  // que las tasks queden huérfanas y caigan silenciosamente en otra
  // columna (bug histórico que metía las tasks de columnas borradas
  // en la primera columna del proyecto sin avisar).
  migrate: z
    .record(z.string(), z.string())
    .optional()
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
    select: { id: true, kanbanColumns: true }
  });
  if (!proj) throw new ApiError(404, "not_found", "Proyecto no encontrado");

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const newIds = new Set(parsed.data.columns.map((c) => c.id));
  if (newIds.size !== parsed.data.columns.length) {
    throw new ApiError(400, "duplicate_id", "IDs duplicados");
  }

  // Detectar columnas ELIMINADAS y comprobar si tienen tasks asignadas.
  const oldCols = Array.isArray(proj.kanbanColumns)
    ? (proj.kanbanColumns as any[])
    : [];
  const removedIds = oldCols
    .map((c: any) => c?.id)
    .filter((id: string) => id && !newIds.has(id));

  if (removedIds.length > 0) {
    const orphans = await prisma.task.groupBy({
      by: ["status"],
      where: {
        workspaceId: api.workspaceId,
        projectId: params.id,
        status: { in: removedIds },
        deletedAt: null
      } as any,
      _count: { _all: true }
    });
    const orphansByCol: Record<string, number> = {};
    for (const o of orphans) orphansByCol[o.status] = (o as any)._count?._all ?? 0;
    const totalOrphans = Object.values(orphansByCol).reduce((s, n) => s + n, 0);

    if (totalOrphans > 0) {
      const migrate = parsed.data.migrate ?? {};
      // Validar: cada columna eliminada con tasks DEBE tener destino
      // en `migrate` y el destino debe existir en las columnas nuevas.
      const unmigrated: Record<string, number> = {};
      for (const [colId, count] of Object.entries(orphansByCol)) {
        const target = migrate[colId];
        if (!target || !newIds.has(target)) {
          unmigrated[colId] = count;
        }
      }
      if (Object.keys(unmigrated).length > 0) {
        throw new ApiError(
          409,
          "tasks_orphans",
          `Hay tasks asignadas a columnas que vas a borrar. Indica adónde moverlas vía 'migrate': ${JSON.stringify(unmigrated)}. Ejemplo body: { columns: [...], migrate: { "${Object.keys(unmigrated)[0]}": "<id_columna_destino>" } }`,
          { orphans: unmigrated }
        );
      }
      // Migración OK: actualizar status de tasks en transacción.
      const updates = Object.entries(migrate)
        .filter(([from]) => orphansByCol[from] > 0)
        .map(([from, to]) =>
          prisma.task.updateMany({
            where: {
              workspaceId: api.workspaceId,
              projectId: params.id,
              status: from,
              deletedAt: null
            } as any,
            data: { status: to }
          })
        );
      await prisma.$transaction([
        ...updates,
        prisma.project.update({
          where: { id: params.id },
          data: { kanbanColumns: parsed.data.columns as any }
        })
      ]);
      return NextResponse.json({
        ok: true,
        items: parsed.data.columns,
        migrated: orphansByCol
      });
    }
  }

  await prisma.project.update({
    where: { id: params.id },
    data: { kanbanColumns: parsed.data.columns as any }
  });
  return NextResponse.json({ ok: true, items: parsed.data.columns });
});
