/**
 * Contrato FASE 2 · objetivo 1 — paginación cursor de tareas.
 */
import { describe, it, expect } from "vitest";
import {
  parseTaskPageParams,
  taskPageFindArgs,
  taskPageCountWhere,
  toTaskPageResult,
  TASK_PAGE_DEFAULT_LIMIT,
  TASK_PAGE_MAX_LIMIT
} from "../task-page";

const sp = (o: Record<string, string>) => new URLSearchParams(o);

describe("parseTaskPageParams", () => {
  it("defaults + cap", () => {
    expect(parseTaskPageParams(sp({})).limit).toBe(TASK_PAGE_DEFAULT_LIMIT);
    expect(parseTaskPageParams(sp({ limit: "500" })).limit).toBe(TASK_PAGE_MAX_LIMIT);
  });
  it("recoge cursor/projectId/status", () => {
    expect(parseTaskPageParams(sp({ cursor: "t1", projectId: "p1", status: "DOING" }))).toEqual({
      limit: TASK_PAGE_DEFAULT_LIMIT,
      cursor: "t1",
      projectId: "p1",
      status: "DOING"
    });
  });
});

describe("taskPageFindArgs", () => {
  it("filtra top-level activo + visibilidad, orden estable, limit+1", () => {
    const vis = { OR: [{ assignees: { some: { userId: "u1" } } }] };
    const args: any = taskPageFindArgs("w1", { limit: 30, cursor: null, projectId: null, status: null }, vis);
    expect(args.where).toMatchObject({ workspaceId: "w1", parentId: null, deletedAt: null, OR: vis.OR });
    expect(args.orderBy).toEqual([{ updatedAt: "desc" }, { id: "asc" }]);
    expect(args.take).toBe(31);
    expect(args.select).toMatchObject({ id: true, title: true, status: true, projectId: true });
    expect(args.cursor).toBeUndefined();
  });
  it("cursor → skip 1; filtros project/status", () => {
    const args: any = taskPageFindArgs("w1", { limit: 10, cursor: "tX", projectId: "p9", status: "TODO" }, null);
    expect(args.cursor).toEqual({ id: "tX" });
    expect(args.skip).toBe(1);
    expect(args.where.projectId).toBe("p9");
    expect(args.where.status).toBe("TODO");
  });
  it("taskPageCountWhere = mismo where sin paginación", () => {
    const w = taskPageCountWhere("w1", { limit: 10, cursor: "x", projectId: null, status: null }, null);
    expect(w).toEqual({ workspaceId: "w1", parentId: null, deletedAt: null });
  });
});

describe("toTaskPageResult", () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, status: "TODO", projectId: null, priority: null, updatedAt: new Date() }));
  it("recorta centinela y da nextCursor", () => {
    const r = toTaskPageResult(rows, 30);
    expect(r.items).toHaveLength(30);
    expect(r.nextCursor).toBe("t29");
  });
  it("sin extra → null; total pasa-through", () => {
    expect(toTaskPageResult(rows.slice(0, 3), 30).nextCursor).toBeNull();
    expect(toTaskPageResult(rows.slice(0, 3), 30, 99).total).toBe(99);
  });
});
