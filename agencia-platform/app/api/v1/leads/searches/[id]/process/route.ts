/**
 * POST /api/v1/leads/searches/[id]/process
 * Procesa un batch de provincias para la búsqueda. Devuelve el progreso.
 *
 * Pensado para llamarse desde la UI (botón "Procesar siguiente batch")
 * o desde un cron interno.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { processSearchBatch } from "@/lib/leads/search-manager";

const schema = z.object({
  batchSize: z.number().int().min(1).max(20).default(5)
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    const out = await processSearchBatch({
      workspaceId: api.workspaceId,
      searchId: params.id,
      batchSize: parsed.data.batchSize
    });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e?.message === "Búsqueda no encontrada") {
      throw new ApiError(404, "not_found", e.message);
    }
    console.error("[search/process] error:", e);
    throw new ApiError(500, "search_error", e?.message ?? "Error procesando búsqueda");
  }
});
