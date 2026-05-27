/**
 * GET /api/v1/gmb/buscador/searches/[id]/results → resultados guardados
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const s = await prisma.gmbSearch.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!s) throw new ApiError(404, "not_found", "Búsqueda no encontrada");
  const results = await prisma.gmbSearchResult.findMany({
    where: { searchId: params.id },
    orderBy: [{ isClaimable: "desc" }, { name: "asc" }]
  });
  return NextResponse.json({ results });
});
