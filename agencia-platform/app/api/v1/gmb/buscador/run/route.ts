/**
 * POST /api/v1/gmb/buscador/run
 * Body: { locations: string[], keyword?, type?, radiusKm? }
 * Busca negocios en Google Maps por cada localización (geocoded) + keyword/tipo,
 * deduplica por place_id y los devuelve. La detección de "reclamable" se hace
 * aparte por place (POST /buscador/verify) para poder paralelizar en el front.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { placesNearby, resolveCoords, MapsKeyMissingError } from "@/lib/integrations/google-maps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  locations: z.array(z.string().min(1)).min(1).max(20),
  keyword: z.string().max(120).optional(),
  type: z.string().max(60).optional(),
  radiusKm: z.number().min(0.5).max(50).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { locations, keyword, type, radiusKm } = parsed.data;

  try {
    const byPlace = new Map<string, any>();
    for (const loc of locations) {
      const coords = await resolveCoords({ workspaceId: api.workspaceId, query: loc });
      if (!coords) continue;
      const places = await placesNearby({
        workspaceId: api.workspaceId,
        lat: coords.lat,
        lng: coords.lng,
        radius: (radiusKm ?? 3) * 1000,
        keyword,
        type
      });
      for (const p of places) {
        if (p.placeId && !byPlace.has(p.placeId)) byPlace.set(p.placeId, { ...p, location: loc });
      }
    }
    const results = Array.from(byPlace.values());
    return NextResponse.json({ count: results.length, results });
  } catch (e: any) {
    if (e instanceof MapsKeyMissingError) throw new ApiError(503, "maps_key_missing", e.message);
    throw new ApiError(502, "maps_error", String(e?.message ?? e));
  }
});
