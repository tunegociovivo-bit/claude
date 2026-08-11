/**
 * GET /api/v1/clients/search  (FASE 2 · objetivo 2)
 *
 * Buscador remoto MÍNIMO de clientes para comboboxes async: devuelve solo
 * id/name/status, paginado por cursor. Pensado para llamarse con debounce desde
 * el cliente (no carga los cientos de campos de /api/v1/clients). No sustituye
 * al endpoint existente; lo complementa.
 *
 * Query: q, status, limit (<=50), cursor, withCount=1
 * Respuesta: { items:[{id,name,status}], nextCursor, total? }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import {
  parseClientSearchParams,
  clientSearchFindArgs,
  clientSearchCountWhere,
  toClientSearchResult
} from "@/lib/db/client-search";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "clients:read" }, async (req, { api }) => {
  const p = parseClientSearchParams(new URL(req.url).searchParams);

  const rowsP = prisma.client.findMany(clientSearchFindArgs(api.workspaceId, p) as any) as Promise<
    { id: string; name: string; status: string }[]
  >;
  const totalP = p.withCount
    ? prisma.client.count({ where: clientSearchCountWhere(api.workspaceId, p) as any })
    : Promise.resolve(undefined);

  const [rows, total] = await Promise.all([rowsP, totalP]);
  const result = toClientSearchResult(rows, p.limit, total as number | undefined);

  // Resultados de búsqueda: no cacheables entre usuarios (dependen del workspace).
  // withApi ya fija no-store; la cache/dedupe la hace el cliente (combobox).
  return NextResponse.json(result);
});
