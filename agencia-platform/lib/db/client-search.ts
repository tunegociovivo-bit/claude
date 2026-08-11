/**
 * Contrato del buscador remoto de clientes (FASE 2 · objetivo 2).
 *
 * Devuelve resultados MÍNIMOS (id / name / status) para poblar un combobox
 * asíncrono sin cargar los cientos de campos de cada Client. Paginación por
 * CURSOR (keyset sobre id, estable) en vez de offset (que degrada con el
 * desplazamiento). Lógica pura y testeable, sin Prisma, para fijar el contrato.
 */

export const CLIENT_SEARCH_DEFAULT_LIMIT = 20;
export const CLIENT_SEARCH_MAX_LIMIT = 50;

export type ClientSearchParams = {
  q: string; // término de búsqueda (nombre), "" = sin filtro
  status: string | null; // filtro opcional por estado (valor de ClientStatus)
  limit: number; // 1..MAX
  cursor: string | null; // id del último resultado de la página previa
  withCount: boolean; // pide `total` (una query extra); por defecto no
};

/** Normaliza los query params (robusto ante valores ausentes o inválidos). */
export function parseClientSearchParams(sp: URLSearchParams): ClientSearchParams {
  const rawLimit = Number(sp.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), CLIENT_SEARCH_MAX_LIMIT) : CLIENT_SEARCH_DEFAULT_LIMIT;
  const q = (sp.get("q") ?? "").trim();
  const status = (sp.get("status") ?? "").trim() || null;
  const cursor = (sp.get("cursor") ?? "").trim() || null;
  const withCount = sp.get("withCount") === "1";
  return { q, status, limit, cursor, withCount };
}

/**
 * Argumentos de `prisma.client.findMany` para la búsqueda. Pide `limit + 1`
 * filas para saber si hay página siguiente sin un count por teclazo. Orden
 * estable (name, id) y SELECT mínimo. Siempre acota por workspaceId (tenant).
 */
export function clientSearchFindArgs(workspaceId: string, p: ClientSearchParams) {
  const where: Record<string, unknown> = { workspaceId, deletedAt: null };
  if (p.status) where.status = p.status;
  if (p.q) where.name = { contains: p.q, mode: "insensitive" };

  const args: Record<string, unknown> = {
    where,
    select: { id: true, name: true, status: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: p.limit + 1 // +1 = centinela de "hay más"
  };
  if (p.cursor) {
    args.cursor = { id: p.cursor };
    args.skip = 1; // saltar el propio cursor
  }
  return args;
}

/** where para el count opcional (mismo filtro, sin cursor). */
export function clientSearchCountWhere(workspaceId: string, p: ClientSearchParams) {
  const where: Record<string, unknown> = { workspaceId, deletedAt: null };
  if (p.status) where.status = p.status;
  if (p.q) where.name = { contains: p.q, mode: "insensitive" };
  return where;
}

export type ClientSearchRow = { id: string; name: string; status: string };
export type ClientSearchResult = {
  items: ClientSearchRow[];
  nextCursor: string | null;
  total?: number;
};

/**
 * Da forma al resultado: recorta la fila centinela y expone `nextCursor`.
 * `rows` viene con hasta `limit + 1` elementos (los que pidió clientSearchFindArgs).
 */
export function toClientSearchResult(rows: ClientSearchRow[], limit: number, total?: number): ClientSearchResult {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.id : null;
  return total === undefined ? { items, nextCursor } : { items, nextCursor, total };
}
