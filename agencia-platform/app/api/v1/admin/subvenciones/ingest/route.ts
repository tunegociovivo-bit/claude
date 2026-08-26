/**
 * POST /api/v1/admin/subvenciones/ingest
 * Descarga/actualiza el catálogo de convocatorias abiertas desde la BDNS.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ingestConvocatorias } from "@/lib/subvenciones/bdns";
import { ingestPlacspMarketingSafe } from "@/lib/subvenciones/placsp";
import { updateSubvencionHealth } from "@/lib/subvenciones/operations";
import { ingestEuFunding } from "@/lib/subvenciones/eu-funding";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// LIMITACIÓN — cooldown: no se puede actualizar más de 1 vez cada 30 min
// (evita martillear la BDNS). El botón manual envía `force: true` en el body.
const COOLDOWN_MS = 30 * 60 * 1000;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const body = (await req.json().catch(() => ({}))) as { daysBack?: number; maxPages?: number; force?: boolean };
  const [workspace, euFundingCount] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } }),
    prisma.subvencionConvocatoria.count({ where: { fuente: "fondos-eu" } })
  ]);
  const retryingFailedSource = /(?:PLACSP|EU):/.test(String((workspace?.settings as any)?.subvenciones?.health?.lastError ?? ""));
  if (!body.force && !retryingFailedSource && euFundingCount > 0) {
    const last = await prisma.subvencionConvocatoria.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
    if (last && Date.now() - last.updatedAt.getTime() < COOLDOWN_MS) {
      const mins = Math.ceil((COOLDOWN_MS - (Date.now() - last.updatedAt.getTime())) / 60000);
      return NextResponse.json({ ok: true, skipped: true, message: `Catálogo actualizado hace poco. Vuelve a actualizar en ~${mins} min.` });
    }
  }
  try {
    const res = await ingestConvocatorias({ daysBack: body.daysBack, maxPages: body.maxPages });
    const placsp = await ingestPlacspMarketingSafe().catch((error) => ({ fetched: 0, relevant: 0, upserted: 0, error: error instanceof Error ? error.message : "Error PLACSP" }));
    const euFunding = await ingestEuFunding().catch((error) => ({ fetched: 0, upserted: 0, error: error instanceof Error ? error.message : "Error EU Funding" }));
    const timestamp = new Date().toISOString();
    const sourceError = ["error" in placsp ? `PLACSP: ${placsp.error}` : "", "error" in euFunding ? `EU: ${euFunding.error}` : ""].filter(Boolean).join(" · ").slice(0, 500) || null;
    await updateSubvencionHealth(api.workspaceId, { lastRunAt: timestamp, lastIngestAt: timestamp, lastError: sourceError, ingested: res.upserted + res.curadas + placsp.upserted + euFunding.upserted, notifications: 0, trigger: "manual" });
    return NextResponse.json({ ok: true, ...res, placsp, euFunding, notificationsSent: 0 });
  } catch (e: any) {
    throw new ApiError(400, "bdns_error", e?.message ?? "No se pudo acceder a la BDNS.");
  }
});
