/**
 * POST /api/v1/gmb/buscador/verify
 * Body: { placeId, name? }
 * Comprueba si una ficha de Google es "reclamable" (sin dueño) vía ScraperAPI.
 * Devuelve { isClaimable: boolean|null }. El front llama esto en paralelo por
 * cada resultado del /buscador/run.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { checkClaimable, ScraperKeyMissingError } from "@/lib/integrations/scraperapi";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({ placeId: z.string().min(1), name: z.string().optional() });

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try {
    const isClaimable = await checkClaimable({
      workspaceId: api.workspaceId,
      placeId: parsed.data.placeId,
      name: parsed.data.name
    });
    return NextResponse.json({ isClaimable });
  } catch (e: any) {
    if (e instanceof ScraperKeyMissingError) throw new ApiError(503, "scraper_key_missing", e.message);
    throw new ApiError(502, "scraper_error", String(e?.message ?? e));
  }
});
