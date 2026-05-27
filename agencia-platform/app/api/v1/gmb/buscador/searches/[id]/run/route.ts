/**
 * POST /api/v1/gmb/buscador/searches/[id]/run → ejecuta la búsqueda ahora
 * Body: { verify?: boolean }  (verify = detectar reclamables con ScraperAPI)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { runGmbSearch } from "@/lib/integrations/gmb-buscador";
import { MapsKeyMissingError } from "@/lib/integrations/google-maps";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const search = await prisma.gmbSearch.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!search) throw new ApiError(404, "not_found", "Búsqueda no encontrada");
  const body = await req.json().catch(() => ({}));
  const verify = body?.verify === true;
  try {
    const r = await runGmbSearch({ workspaceId: api.workspaceId, search, verify });
    return NextResponse.json(r);
  } catch (e: any) {
    if (e instanceof MapsKeyMissingError) throw new ApiError(503, "maps_key_missing", e.message);
    throw new ApiError(502, "search_error", String(e?.message ?? e));
  }
});
