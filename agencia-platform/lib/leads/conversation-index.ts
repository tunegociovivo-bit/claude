/**
 * Índice/summary de conversaciones con paginación por CURSOR (FASE 2 · objetivo 1).
 *
 * PROBLEMA: la ruta actual carga los N mensajes más recientes y los agrupa en JS.
 * Paginar cortando esa lista de mensajes AGRUPARÍA PÁGINAS PARCIALES (los
 * mensajes de una conversación podrían quedar repartidos entre páginas) y
 * falsearía `unread`/`total`. Es la "paginación engañosa" que hay que evitar.
 *
 * SOLUCIÓN (cursor por conversación, seguro): la agrupación se hace EN SQL
 * (`GROUP BY COALESCE(phoneNormalized, fromPhone)`), así cada conversación es
 * una fila atómica y nunca se parte entre páginas. La paginación es keyset sobre
 * `(last_at DESC, phone ASC)`.
 *
 * INVARIANTES (documentadas y testeadas donde es posible sin BD):
 *   INV1  Una conversación = una fila (clave `COALESCE(phoneNormalized,fromPhone)`).
 *         Nunca se parte entre páginas (la agrupación es previa al corte).
 *   INV2  `unread` = nº REAL de entrantes no leídos de esa conversación
 *         (COUNT FILTER sobre TODA la conversación, no acotado por una ventana).
 *   INV3  Orden estable `last_at DESC, phone ASC` → cursor keyset determinista.
 *   INV4  cursor = (last_at, phone); la página siguiente son las filas con
 *         `last_at < c.last_at OR (last_at = c.last_at AND phone > c.phone)`.
 *   INV5  `total` = nº de conversaciones distintas; `totalUnread` = SUMA de unread
 *         (ambos con los MISMOS filtros que la página, sin cursor ni limit).
 *
 * ALCANCE de filtros en esta versión: `account` (instanceName) y rango de fecha
 * (`receivedAt`, dateFrom y dateTo INDEPENDIENTES), que son puros sobre
 * LeadInboxMessage. Los filtros `blocked` (LeadOptout) y `q` (búsqueda por texto)
 * NO se cubren aquí a propósito: la ruta completa existente los sigue sirviendo.
 * No se expone una paginación que finja soportarlos.
 *
 * COSTE (honesto): el `GROUP BY` recorre los mensajes del workspace en CADA
 * página; el índice `(workspaceId,receivedAt)` (migración obj 7, no aplicada)
 * reduce escaneo/orden pero NO evita el hash-aggregate completo → per-página
 * ~O(mensajes), no O(limit). Para O(limit) real a escala haría falta una tabla
 * de summary por conversación mantenida. Por eso este endpoint está gated en
 * EXPLAIN y no cableado a la UI.
 */
import { Prisma } from "@prisma/client";
import { DEFAULT_ACCOUNT } from "./inbox-conversations";

export const CONV_INDEX_DEFAULT_LIMIT = 30;
export const CONV_INDEX_MAX_LIMIT = 100;

export type ConvCursor = { lastAt: string; phone: string };
export type ConvIndexParams = {
  limit: number;
  cursor: ConvCursor | null;
  account: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
};

export function parseConvIndexParams(sp: URLSearchParams): ConvIndexParams {
  const rawLimit = Number(sp.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), CONV_INDEX_MAX_LIMIT) : CONV_INDEX_DEFAULT_LIMIT;
  const account = (sp.get("account") ?? "").trim() || null;
  const fromRaw = sp.get("dateFrom");
  const toRaw = sp.get("dateTo");
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  // dateFrom y dateTo son independientes: un "desde" abierto (solo dateFrom) SÍ
  // filtra receivedAt >= dateFrom; no se ignora.
  const dateFrom = from && !isNaN(from.getTime()) ? from : null;
  const dateTo = to && !isNaN(to.getTime()) ? to : null;
  return { limit, cursor: decodeConvCursor(sp.get("cursor")), account, dateFrom, dateTo };
}

/** cursor opaco = base64("<lastAtISO>|<phone>"). El phone puede no llevar '|'. */
export function encodeConvCursor(row: { lastAt: string; phone: string }): string {
  return Buffer.from(`${row.lastAt}|${row.phone}`, "utf8").toString("base64");
}
export function decodeConvCursor(raw: string | null | undefined): ConvCursor | null {
  if (!raw) return null;
  try {
    const s = Buffer.from(raw, "base64").toString("utf8");
    const i = s.indexOf("|");
    if (i < 0) return null;
    const lastAt = s.slice(0, i);
    const phone = s.slice(i + 1);
    if (!lastAt || !phone || isNaN(new Date(lastAt).getTime())) return null;
    return { lastAt, phone };
  } catch {
    return null;
  }
}

/** Condiciones WHERE comunes (workspace + account + fecha) como fragmento SQL. */
function innerWhere(workspaceId: string, p: ConvIndexParams): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`"workspaceId" = ${workspaceId}`];
  if (p.account) {
    if (p.account === DEFAULT_ACCOUNT) conds.push(Prisma.sql`"instanceName" IS NULL`);
    else conds.push(Prisma.sql`"instanceName" = ${p.account}`);
  }
  if (p.dateFrom) conds.push(Prisma.sql`"receivedAt" >= ${p.dateFrom}`);
  if (p.dateTo) conds.push(Prisma.sql`"receivedAt" < ${p.dateTo}`);
  return Prisma.join(conds, " AND ");
}

/** Subconsulta agrupada (una fila por conversación) — INV1/INV2. */
function groupedSubquery(workspaceId: string, p: ConvIndexParams): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE("phoneNormalized", "fromPhone") AS phone,
           MAX("receivedAt") AS last_at,
           COUNT(*) FILTER (WHERE direction = 'in' AND read = false)::int AS unread
    FROM "LeadInboxMessage"
    WHERE ${innerWhere(workspaceId, p)}
    GROUP BY 1`;
}

/** Página de conversaciones (keyset, limit+1 para saber si hay más) — INV3/INV4. */
export function buildConvIndexQuery(workspaceId: string, p: ConvIndexParams): Prisma.Sql {
  const keyset = p.cursor
    ? Prisma.sql`WHERE (last_at < ${new Date(p.cursor.lastAt)} OR (last_at = ${new Date(p.cursor.lastAt)} AND phone > ${p.cursor.phone}))`
    : Prisma.empty;
  return Prisma.sql`
    SELECT phone, last_at AS "lastAt", unread
    FROM ( ${groupedSubquery(workspaceId, p)} ) conv
    ${keyset}
    ORDER BY last_at DESC, phone ASC
    LIMIT ${p.limit + 1}`;
}

/** total + totalUnread con los MISMOS filtros (sin cursor ni limit) — INV5. */
export function buildConvCountQuery(workspaceId: string, p: ConvIndexParams): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::int AS total, COALESCE(SUM(unread), 0)::int AS "totalUnread"
    FROM ( ${groupedSubquery(workspaceId, p)} ) conv`;
}

export type ConvIndexRow = { phone: string; lastAt: Date; unread: number };
export type ConvIndexResult = {
  items: { phone: string; lastAt: string; unread: number }[];
  nextCursor: string | null;
};

/** Recorta la fila centinela (limit+1) y emite nextCursor. */
export function toConvIndexResult(rows: ConvIndexRow[], limit: number): ConvIndexResult {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map((r) => ({
    phone: r.phone,
    lastAt: r.lastAt instanceof Date ? r.lastAt.toISOString() : String(r.lastAt),
    unread: Number(r.unread) || 0
  }));
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeConvCursor(last) : null;
  return { items, nextCursor };
}
