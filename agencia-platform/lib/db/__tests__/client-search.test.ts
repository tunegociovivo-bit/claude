/**
 * Contrato FASE 2 · objetivo 2 — buscador remoto de clientes (paginación cursor).
 */
import { describe, it, expect } from "vitest";
import {
  parseClientSearchParams,
  clientSearchFindArgs,
  clientSearchCountWhere,
  toClientSearchResult,
  CLIENT_SEARCH_DEFAULT_LIMIT,
  CLIENT_SEARCH_MAX_LIMIT
} from "../client-search";

const sp = (o: Record<string, string>) => new URLSearchParams(o);

describe("parseClientSearchParams", () => {
  it("defaults sensatos y trim", () => {
    const p = parseClientSearchParams(sp({}));
    expect(p).toEqual({ q: "", status: null, limit: CLIENT_SEARCH_DEFAULT_LIMIT, cursor: null, withCount: false });
  });
  it("limita al cap y descarta valores inválidos", () => {
    expect(parseClientSearchParams(sp({ limit: "999" })).limit).toBe(CLIENT_SEARCH_MAX_LIMIT);
    expect(parseClientSearchParams(sp({ limit: "-5" })).limit).toBe(CLIENT_SEARCH_DEFAULT_LIMIT);
    expect(parseClientSearchParams(sp({ limit: "abc" })).limit).toBe(CLIENT_SEARCH_DEFAULT_LIMIT);
  });
  it("recoge q/status/cursor/withCount", () => {
    const p = parseClientSearchParams(sp({ q: "  Bar  ", status: "ACTIVE", cursor: "c1", withCount: "1" }));
    expect(p).toEqual({ q: "Bar", status: "ACTIVE", limit: CLIENT_SEARCH_DEFAULT_LIMIT, cursor: "c1", withCount: true });
  });
});

describe("clientSearchFindArgs", () => {
  it("acota por workspace, select mínimo, pide limit+1, orden estable", () => {
    const args: any = clientSearchFindArgs("w1", { q: "", status: null, limit: 20, cursor: null, withCount: false });
    expect(args.where).toEqual({ workspaceId: "w1", deletedAt: null });
    expect(args.select).toEqual({ id: true, name: true, status: true });
    expect(args.orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(args.take).toBe(21);
    expect(args.cursor).toBeUndefined();
  });
  it("aplica filtro de nombre (insensible) y status", () => {
    const args: any = clientSearchFindArgs("w1", { q: "bar", status: "PAUSED", limit: 10, cursor: null, withCount: false });
    expect(args.where.name).toEqual({ contains: "bar", mode: "insensitive" });
    expect(args.where.status).toBe("PAUSED");
  });
  it("cursor → skip 1 y cursor por id", () => {
    const args: any = clientSearchFindArgs("w1", { q: "", status: null, limit: 20, cursor: "cX", withCount: false });
    expect(args.cursor).toEqual({ id: "cX" });
    expect(args.skip).toBe(1);
  });
});

describe("clientSearchCountWhere", () => {
  it("mismo filtro sin cursor", () => {
    expect(clientSearchCountWhere("w1", { q: "bar", status: "ACTIVE", limit: 20, cursor: "x", withCount: true })).toEqual({
      workspaceId: "w1",
      deletedAt: null,
      status: "ACTIVE",
      name: { contains: "bar", mode: "insensitive" }
    });
  });
});

describe("toClientSearchResult", () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, name: `N${i}`, status: "ACTIVE" }));
  it("recorta la fila centinela y expone nextCursor cuando hay más", () => {
    const r = toClientSearchResult(rows, 20);
    expect(r.items).toHaveLength(20);
    expect(r.nextCursor).toBe("c19");
    expect(r.total).toBeUndefined();
  });
  it("sin fila extra → nextCursor null", () => {
    const r = toClientSearchResult(rows.slice(0, 5), 20);
    expect(r.items).toHaveLength(5);
    expect(r.nextCursor).toBeNull();
  });
  it("incluye total si se pasa", () => {
    expect(toClientSearchResult(rows.slice(0, 3), 20, 42).total).toBe(42);
  });
});
