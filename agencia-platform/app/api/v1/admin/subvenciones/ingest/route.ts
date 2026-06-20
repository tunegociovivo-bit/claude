/**
 * POST /api/v1/admin/subvenciones/ingest
 * Descarga/actualiza el catálogo de convocatorias abiertas desde la BDNS.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ingestConvocatorias } from "@/lib/subvenciones/bdns";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req) => {
  const body = (await req.json().catch(() => ({}))) as { daysBack?: number; maxPages?: number };
  try {
    const res = await ingestConvocatorias({ daysBack: body.daysBack, maxPages: body.maxPages });
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    throw new ApiError(400, "bdns_error", e?.message ?? "No se pudo acceder a la BDNS.");
  }
});
