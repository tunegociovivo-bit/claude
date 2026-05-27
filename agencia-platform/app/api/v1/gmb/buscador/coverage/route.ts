/**
 * GET /api/v1/gmb/buscador/coverage → puntos agregados (lat/lng/reclamable)
 * para pintar el mapa de cobertura. Opcional ?searchId=...
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const searchId = new URL(req.url).searchParams.get("searchId");
  const results = await prisma.gmbSearchResult.findMany({
    where: {
      workspaceId: api.workspaceId,
      ...(searchId ? { searchId } : {}),
      NOT: { lat: 0 }
    },
    select: { lat: true, lng: true, isClaimable: true, name: true },
    take: 2000
  });
  const total = results.length;
  const claimable = results.filter((r) => r.isClaimable).length;
  return NextResponse.json({ points: results, total, claimable });
});
