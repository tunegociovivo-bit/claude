/**
 * POST /api/v1/gmb/clients/[id]/grid-rank
 * Body: { keyword, size?, radiusKm? }
 * Escanea el ranking por zonas del negocio para un keyword (rejilla NxN vía
 * Maps). Guarda el resultado en GmbPosition y lo devuelve. Operación pesada
 * (1 llamada Maps por celda) — size cap 7.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { gridRank, resolveCoords, MapsKeyMissingError } from "@/lib/integrations/google-maps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  keyword: z.string().min(1).max(120),
  size: z.number().int().min(3).max(7).optional(),
  radiusKm: z.number().min(0.5).max(20).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const c = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    // Resolver coordenadas: las guardadas, o por placeId/nombre+dirección.
    let lat = c.latitude;
    let lng = c.longitude;
    let placeId = c.placeId || undefined;
    if (lat == null || lng == null) {
      const coords = await resolveCoords({
        workspaceId: api.workspaceId,
        placeId,
        query: [c.name, c.address].filter(Boolean).join(" ")
      });
      if (!coords) throw new ApiError(422, "no_coords", "No pude localizar el negocio en el mapa. Revisa el nombre/dirección o añade el Place ID.");
      lat = coords.lat;
      lng = coords.lng;
      placeId = coords.placeId ?? placeId;
      // Persistir para próximas veces
      await prisma.gmbClient.update({
        where: { id: c.id },
        data: { latitude: lat, longitude: lng, placeId: placeId ?? c.placeId }
      });
    }

    const result = await gridRank({
      workspaceId: api.workspaceId,
      lat: lat!,
      lng: lng!,
      keyword: parsed.data.keyword,
      businessName: c.name,
      placeId,
      size: parsed.data.size,
      radiusKm: parsed.data.radiusKm
    });

    await prisma.gmbPosition.create({
      data: {
        workspaceId: api.workspaceId,
        clientId: c.id,
        keyword: parsed.data.keyword,
        avgPosition: result.avgPosition,
        top3Count: result.top3Count,
        foundCount: result.foundCount,
        cellCount: result.cellCount,
        gridData: result.cells as any
      }
    });

    return NextResponse.json({
      keyword: parsed.data.keyword,
      avgPosition: result.avgPosition,
      top3Count: result.top3Count,
      foundCount: result.foundCount,
      cellCount: result.cellCount,
      cells: result.cells
    });
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (e instanceof MapsKeyMissingError) throw new ApiError(503, "maps_key_missing", e.message);
    throw new ApiError(502, "maps_error", String(e?.message ?? e));
  }
});
