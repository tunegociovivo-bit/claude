/**
 * Contrato de paginación por cursor de tareas (FASE 2 · objetivo 1).
 *
 * Devuelve tareas top-level (no subtareas, no papelera) paginadas por cursor
 * keyset sobre (updatedAt desc, id), con SELECT mínimo para una vista de lista.
 * Respeta la visibilidad por usuario (el `where` de visibilidad se inyecta desde
 * la ruta, reutilizando taskVisibilityWhere). Aditivo: no cambia getTasksForUi.
 */

export const TASK_PAGE_DEFAULT_LIMIT = 30;
export const TASK_PAGE_MAX_LIMIT = 100;

export type TaskPageParams = {
  limit: number;
  cursor: string | null; // id de la última tarea de la página previa
  projectId: string | null;
  status: string | null;
};

export function parseTaskPageParams(sp: URLSearchParams): TaskPageParams {
  const rawLimit = Number(sp.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), TASK_PAGE_MAX_LIMIT) : TASK_PAGE_DEFAULT_LIMIT;
  return {
    limit,
    cursor: (sp.get("cursor") ?? "").trim() || null,
    projectId: (sp.get("projectId") ?? "").trim() || null,
    status: (sp.get("status") ?? "").trim() || null
  };
}

function baseWhere(workspaceId: string, p: TaskPageParams, visibility: Record<string, unknown> | null): Record<string, unknown> {
  const where: Record<string, unknown> = { workspaceId, parentId: null, deletedAt: null, ...(visibility ?? {}) };
  if (p.projectId) where.projectId = p.projectId;
  if (p.status) where.status = p.status;
  return where;
}

export function taskPageFindArgs(workspaceId: string, p: TaskPageParams, visibility: Record<string, unknown> | null) {
  const args: Record<string, unknown> = {
    where: baseWhere(workspaceId, p, visibility),
    select: { id: true, title: true, status: true, projectId: true, priority: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: p.limit + 1
  };
  if (p.cursor) {
    args.cursor = { id: p.cursor };
    args.skip = 1;
  }
  return args;
}

export function taskPageCountWhere(workspaceId: string, p: TaskPageParams, visibility: Record<string, unknown> | null) {
  return baseWhere(workspaceId, p, visibility);
}

export type TaskPageRow = { id: string; title: string; status: string; projectId: string | null; priority: string | null; updatedAt: Date };
export type TaskPageResult = { items: TaskPageRow[]; nextCursor: string | null; total?: number };

export function toTaskPageResult(rows: TaskPageRow[], limit: number, total?: number): TaskPageResult {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.id : null;
  return total === undefined ? { items, nextCursor } : { items, nextCursor, total };
}
