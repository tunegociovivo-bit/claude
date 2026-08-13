/**
 * /api/v1/leads/franchises/enrich-owners — identificación de titulares de franquicia.
 *
 * POST: ENCOLA (no investiga en la request → nunca 502 por timeout de proxy). Marca los leads
 *   brand_locations como "queued"; el cron los procesa en segundo plano. Devuelve rápido.
 *   body { searchId? | ids? (≤50), force?, limit? }.
 * GET: progreso/estado para la UI. ?searchId= → { queued, done, error }; ?ids= → estado por lead.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { queueFranchiseOwnerResearch, franchiseOwnerProgress } from "@/lib/leads/franchise-owner-queue";

export const dynamic = "force-dynamic";

const schema = z.object({
  searchId: z.string().optional(),
  ids: z.array(z.string()).max(50).optional(),
  force: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).default(1000)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (!parsed.data.searchId && !parsed.data.ids?.length) throw new ApiError(400, "missing_target", "Selecciona una búsqueda o leads concretos");

  // Solo ENCOLA (rápido). El cron investiga en segundo plano, por lotes y con reintentos.
  const out = await queueFranchiseOwnerResearch(prisma, api.workspaceId, {
    searchId: parsed.data.searchId,
    ids: parsed.data.ids,
    force: parsed.data.force,
    limit: parsed.data.limit
  });
  const progress = await franchiseOwnerProgress(prisma, api.workspaceId, parsed.data.searchId);
  return NextResponse.json({ ok: true, queued: out.queued, skipped: out.skipped, scanned: out.scanned, progress, note: "Encolado. Se investiga en segundo plano; refresca para ver los resultados." });
});

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const searchId = url.searchParams.get("searchId")?.trim() || undefined;
  const idsParam = url.searchParams.get("ids")?.trim();
  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
    const leads = await prisma.lead.findMany({ where: { workspaceId: api.workspaceId, id: { in: ids } }, select: { id: true, name: true, rawData: true } });
    const items = leads.map((l: any) => ({ id: l.id, name: l.name, franchiseOwner: (l.rawData as any)?.franchiseOwner ?? null }));
    return NextResponse.json({ ok: true, items });
  }
  const progress = await franchiseOwnerProgress(prisma, api.workspaceId, searchId);
  return NextResponse.json({ ok: true, progress });
});
