/**
 * POST /api/v1/admin/subvenciones/ingest
 * Descarga/actualiza el catálogo de convocatorias abiertas desde la BDNS.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ingestConvocatorias } from "@/lib/subvenciones/bdns";
import { ingestPlacspMarketing } from "@/lib/subvenciones/placsp";
import { updateSubvencionHealth } from "@/lib/subvenciones/operations";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// LIMITACIÓN — cooldown: no se puede actualizar más de 1 vez cada 30 min
// (evita martillear la BDNS). Se salta con ?force=1.
const COOLDOWN_MS = 30 * 60 * 1000;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const body = (await req.json().catch(() => ({}))) as { daysBack?: number; maxPages?: number; force?: boolean };
  const workspace = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const retryingFailedSource = String((workspace?.settings as any)?.subvenciones?.health?.lastError ?? "").startsWith("PLACSP:");
  if (!body.force && !retryingFailedSource) {
    const last = await prisma.subvencionConvocatoria.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
    if (last && Date.now() - last.updatedAt.getTime() < COOLDOWN_MS) {
      const mins = Math.ceil((COOLDOWN_MS - (Date.now() - last.updatedAt.getTime())) / 60000);
      return NextResponse.json({ ok: true, skipped: true, message: `Catálogo actualizado hace poco. Vuelve a actualizar en ~${mins} min.` });
    }
  }
  try {
    const res = await ingestConvocatorias({ daysBack: body.daysBack, maxPages: body.maxPages });
    const placsp = await ingestPlacspMarketing().catch((error) => ({ fetched: 0, relevant: 0, upserted: 0, error: error instanceof Error ? error.message : "Error PLACSP" }));
    const timestamp = new Date().toISOString();
    await updateSubvencionHealth(api.workspaceId, { lastRunAt: timestamp, lastIngestAt: timestamp, lastError: "error" in placsp ? `PLACSP: ${placsp.error}`.slice(0, 500) : null, ingested: res.upserted + res.curadas + placsp.upserted, notifications: 0, trigger: "manual" });
    return NextResponse.json({ ok: true, ...res, placsp, notificationsSent: 0 });
  } catch (e: any) {
    throw new ApiError(400, "bdns_error", e?.message ?? "No se pudo acceder a la BDNS.");
  }
});
