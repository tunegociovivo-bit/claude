/**
 * GET /api/v1/admin/import-accesos-asana/diagnose
 *
 * Diagnóstico SIN escribir nada en BD:
 * - Lista las subtareas de Asana CLIENTES (sólo nombres, 1 call)
 * - Lista los clientes de BD (id, name, accesos length)
 * - Para cada subtarea Asana, intenta matchear contra BD
 * - Devuelve la tabla con matches/no-matches/mismatched-naming
 *   sin tocar nada
 *
 * Útil cuando "el importador no muestra cambios" para entender qué
 * pasó: la lista de no-match suele ser la mayoría del problema
 * (nombres distintos en Asana vs en BD).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { listSubtasks } from "@/lib/asana/api";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "unauthorized", "No hay usuario");
  const url = new URL(req.url);
  const rootTaskId = url.searchParams.get("rootTaskId") ?? "1201694137821107";

  const conn = await prisma.asanaConnection.findFirst({
    where: { userId: api.userId },
    orderBy: { createdAt: "desc" }
  });
  if (!conn) {
    return NextResponse.json({
      error: "No tienes Asana vinculado. Conecta en /admin/asana primero.",
      asanaConnected: false
    });
  }

  const asanaSubs = await listSubtasks(conn.accessToken, rootTaskId).catch((e) => {
    throw new ApiError(502, "asana_error", `Asana respondió error: ${e.message}`);
  });

  const dbClients = await prisma.client.findMany({
    where: { workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true, name: true, accesos: true }
  });

  const dbIndex = dbClients.map((c) => ({
    id: c.id,
    name: c.name,
    norm: normalize(c.name),
    accesosLen: c.accesos?.length ?? 0
  }));

  type Row = {
    asanaName: string;
    matchedDbName: string | null;
    matchType: "exact" | "contains" | "none";
    dbAccesosLen: number;
  };

  const rows: Row[] = asanaSubs.map((sub) => {
    const n = normalize(sub.name);
    let exact = dbIndex.find((c) => c.norm === n);
    if (exact)
      return {
        asanaName: sub.name,
        matchedDbName: exact.name,
        matchType: "exact",
        dbAccesosLen: exact.accesosLen
      };
    let contains = dbIndex.find((c) => n.includes(c.norm) || c.norm.includes(n));
    if (contains)
      return {
        asanaName: sub.name,
        matchedDbName: contains.name,
        matchType: "contains",
        dbAccesosLen: contains.accesosLen
      };
    return {
      asanaName: sub.name,
      matchedDbName: null,
      matchType: "none",
      dbAccesosLen: 0
    };
  });

  const summary = {
    asanaTotal: asanaSubs.length,
    dbTotal: dbClients.length,
    exact: rows.filter((r) => r.matchType === "exact").length,
    contains: rows.filter((r) => r.matchType === "contains").length,
    noMatch: rows.filter((r) => r.matchType === "none").length,
    alreadyHasAccesos: rows.filter((r) => r.matchType !== "none" && r.dbAccesosLen > 0).length
  };

  return NextResponse.json({
    asanaConnected: true,
    summary,
    rows: rows.sort((a, b) => {
      // Sin match primero (más urgente), luego contains, luego exact
      const order = { none: 0, contains: 1, exact: 2 } as const;
      return order[a.matchType] - order[b.matchType];
    })
  });
});
