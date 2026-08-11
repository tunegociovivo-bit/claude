/**
 * GET /api/v1/leads/inbox/conversations/index  (FASE 2 · objetivo 1)
 *
 * Índice de conversaciones paginado por CURSOR, SEGURO: la agrupación por
 * conversación se hace en SQL (GROUP BY), así ninguna conversación se parte
 * entre páginas y `unread` es el REAL (no acotado por una ventana de mensajes).
 * Ver invariantes en lib/leads/conversation-index.ts.
 *
 * ADITIVO: no sustituye a /conversations (que sigue sirviendo blocked/búsqueda y
 * el enriquecimiento por meta/lead). Este endpoint NO está cableado a la UI
 * todavía; ejecutar EXPLAIN con el índice LeadInboxMessage(workspaceId,
 * receivedAt) antes de conectarlo.
 *
 * Respuesta: { items:[{phone,lastAt,unread}], nextCursor, total, totalUnread }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import {
  parseConvIndexParams,
  buildConvIndexQuery,
  buildConvCountQuery,
  toConvIndexResult,
  type ConvIndexRow
} from "@/lib/leads/conversation-index";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const p = parseConvIndexParams(new URL(req.url).searchParams);

  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<ConvIndexRow[]>(buildConvIndexQuery(api.workspaceId, p)),
    prisma.$queryRaw<{ total: number; totalUnread: number }[]>(buildConvCountQuery(api.workspaceId, p))
  ]);

  const result = toConvIndexResult(rows, p.limit);
  const c = counts[0] ?? { total: 0, totalUnread: 0 };
  return NextResponse.json({ ...result, total: Number(c.total) || 0, totalUnread: Number(c.totalUnread) || 0 });
});
