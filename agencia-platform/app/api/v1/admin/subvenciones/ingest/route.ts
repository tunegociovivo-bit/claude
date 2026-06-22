/**
 * POST /api/v1/admin/subvenciones/ingest
 * Descarga/actualiza el catálogo de convocatorias abiertas desde la BDNS.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ingestConvocatorias } from "@/lib/subvenciones/bdns";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// LIMITACIÓN — cooldown: no se puede actualizar más de 1 vez cada 30 min
// (evita martillear la BDNS). Se salta con ?force=1.
const COOLDOWN_MS = 30 * 60 * 1000;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req) => {
  const body = (await req.json().catch(() => ({}))) as { daysBack?: number; maxPages?: number; force?: boolean };
  if (!body.force) {
    const last = await prisma.subvencionConvocatoria.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
    if (last && Date.now() - last.updatedAt.getTime() < COOLDOWN_MS) {
      const mins = Math.ceil((COOLDOWN_MS - (Date.now() - last.updatedAt.getTime())) / 60000);
      return NextResponse.json({ ok: true, skipped: true, message: `Catálogo actualizado hace poco. Vuelve a actualizar en ~${mins} min.` });
    }
  }
  try {
    const res = await ingestConvocatorias({ daysBack: body.daysBack, maxPages: body.maxPages });
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    throw new ApiError(400, "bdns_error", e?.message ?? "No se pudo acceder a la BDNS.");
  }
});
