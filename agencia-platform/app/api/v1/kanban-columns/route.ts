/**
 * Configuración de columnas del Kanban — WORKSPACE level (default global).
 *
 * Vive en workspace.settings.kanban.columns como array ordenado.
 *
 * Para columnas POR PROYECTO usa /api/v1/projects/[id]/kanban-columns.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { readKanbanColumns } from "@/lib/kanban";

const updateSchema = z.object({
  columns: z
    .array(
      z.object({
        id: z.string().min(1).max(40).regex(/^[A-Z0-9_]+$/, "ID debe ser MAYÚSCULAS_CON_GUIONES_BAJOS"),
        label: z.string().min(1).max(40),
        color: z.string().max(120).optional(),
        order: z.number().int().min(0).max(99),
        isDone: z.boolean().optional()
      })
    )
    .min(1)
    .max(20)
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings = (ws?.settings as any) ?? {};
  return NextResponse.json({ items: readKanbanColumns(settings) });
});

export const PUT = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId }
  });
  if (!me || me.role !== "ADMIN") {
    throw new ApiError(403, "forbidden", "Solo admins pueden configurar columnas");
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ids = new Set(parsed.data.columns.map((c) => c.id));
  if (ids.size !== parsed.data.columns.length) {
    throw new ApiError(400, "duplicate_id", "Hay IDs duplicados en las columnas");
  }

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  settings.kanban ??= {};
  settings.kanban.columns = parsed.data.columns;

  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });

  return NextResponse.json({ ok: true, items: readKanbanColumns(settings) });
});
