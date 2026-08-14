/**
 * /api/v1/leads/franchises/enrich-contacts — FASE 2: contacto profesional del titular.
 *
 * POST: ENCOLA (no busca en la request → nunca 502). Solo sobre leads con titular identificado.
 *   body { searchId? | ids? (≤50), force?, retryErrors?, limit? }. Devuelve rápido + skippedReasons.
 * GET: progreso/estado para la UI. ?diag=1 → diagnóstico; ?ids= → contacto por lead; else progreso.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { queueFranchiseContactResearch, franchiseContactProgress, franchiseContactDiag } from "@/lib/leads/franchise-contact-queue";

export const dynamic = "force-dynamic";

const schema = z.object({
  searchId: z.string().optional(),
  ids: z.array(z.string()).max(50).optional(),
  force: z.boolean().optional(),
  retryErrors: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).default(1000)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (!parsed.data.searchId && !parsed.data.ids?.length) throw new ApiError(400, "missing_target", "Selecciona una búsqueda o leads concretos");

  const out = await queueFranchiseContactResearch(prisma, api.workspaceId, {
    searchId: parsed.data.searchId,
    ids: parsed.data.ids,
    force: parsed.data.force,
    retryErrors: parsed.data.retryErrors,
    limit: parsed.data.limit
  });
  const progress = await franchiseContactProgress(prisma, api.workspaceId, parsed.data.searchId);
  const sr = out.skippedReasons;
  const note = out.scanned === 0
    ? "La búsqueda no tiene leads."
    : out.queued === 0
      ? `Nada encolado: ${sr.notIdentified} sin titular identificado, ${sr.alreadyContactable} ya contactables, ${sr.running} en curso.`
      : "Buscando contacto en segundo plano; refresca para ver emails/móviles encontrados.";
  return NextResponse.json({ ok: true, queued: out.queued, skipped: out.skipped, scanned: out.scanned, skippedReasons: sr, progress, note });
});

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const searchId = url.searchParams.get("searchId")?.trim() || undefined;
  const idsParam = url.searchParams.get("ids")?.trim();
  if (url.searchParams.get("diag")) {
    const diag = await franchiseContactDiag(prisma, api.workspaceId, searchId);
    return NextResponse.json({ ok: true, diag });
  }
  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
    const leads = await prisma.lead.findMany({ where: { workspaceId: api.workspaceId, id: { in: ids } }, select: { id: true, name: true, rawData: true } });
    const items = leads.map((l: any) => ({ id: l.id, name: l.name, contact: (l.rawData as any)?.franchiseOwner?.contact ?? null }));
    return NextResponse.json({ ok: true, items });
  }
  const progress = await franchiseContactProgress(prisma, api.workspaceId, searchId);
  return NextResponse.json({ ok: true, progress });
});
