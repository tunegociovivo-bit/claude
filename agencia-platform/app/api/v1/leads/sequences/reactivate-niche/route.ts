/**
 * Reactivar una secuencia por nicho.
 *
 *  GET  → nichos (palabra clave de búsqueda) y secuencias disponibles.
 *  GET  ?niche=&sequenceId=&fromStep=&minDays=&includeUnanswered=1
 *       → vista previa: quién entra, por qué quedan fuera los demás y cómo
 *         va la secuencia en ese nicho.
 *  POST { niche, sequenceId, fromStep, minDaysSinceContact?, includeUnanswered? }
 *       → recalcula en el servidor y activa la secuencia desde ese paso.
 *         El procesador la encola poco a poco y respeta el ritmo de la cola.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { assertSameOrigin } from "@/lib/api/csrf";
import { prisma } from "@/lib/db/prisma";
import { uniqueSequenceSteps } from "@/lib/leads/sequences";
import { analyzeNicheReactivation, applyNicheReactivation, listSequenceNiches, REACTIVATION_REASONS, ReactivationError } from "@/lib/leads/sequence-reactivation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function mapError(error: unknown): never {
  if (error instanceof ReactivationError) throw new ApiError(error.code === "invalid_step" ? 400 : 404, error.code, error.message);
  throw error;
}

function summarize(analysis: Awaited<ReturnType<typeof analyzeNicheReactivation>>) {
  return {
    niche: analysis.niche,
    sequence: analysis.sequence,
    options: analysis.options,
    eligibleCount: analysis.eligible.length,
    eligibleSample: analysis.eligible.slice(0, 12).map((lead) => ({ id: lead.id, name: lead.name, lastSentAt: lead.lastSentAt })),
    excluded: Object.entries(analysis.excluded)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => ({ reason, label: REACTIVATION_REASONS[reason as keyof typeof REACTIVATION_REASONS], count }))
      .sort((a, b) => b.count - a.count),
    progress: analysis.progress
  };
}

export const GET = withApi({ scope: "*", rateLimit: { user: 60 } }, async (req, { api }) => {
  const params = req.nextUrl.searchParams;
  const niche = params.get("niche");
  if (!niche) {
    const [niches, sequences] = await Promise.all([
      listSequenceNiches(api.workspaceId),
      prisma.leadSequence.findMany({ where: { workspaceId: api.workspaceId, active: true }, include: { steps: { orderBy: { order: "asc" } } }, orderBy: { createdAt: "asc" } })
    ]);
    return NextResponse.json({
      niches: niches.map((item) => ({ key: item.key, keyword: item.keyword, searches: item.searchIds.length, leads: item.leads, contacted: item.contacted, responded: item.responded, lastSearchAt: item.lastSearchAt })),
      sequences: sequences.map((sequence) => ({
        id: sequence.id,
        name: sequence.name,
        isDefault: sequence.isDefault,
        steps: uniqueSequenceSteps(sequence.steps).map((step, index) => ({ number: index + 1, delayDays: step.delayDays, preview: step.templateBody.slice(0, 160) }))
      }))
    });
  }
  const sequenceId = params.get("sequenceId");
  if (!sequenceId) throw new ApiError(400, "validation_error", "Elige una secuencia");
  try {
    const analysis = await analyzeNicheReactivation({
      workspaceId: api.workspaceId,
      niche,
      sequenceId,
      fromStep: Number(params.get("fromStep") ?? 2),
      minDaysSinceContact: Number(params.get("minDays") ?? 2),
      includeUnanswered: params.get("includeUnanswered") === "1"
    });
    return NextResponse.json(summarize(analysis));
  } catch (error) {
    mapError(error);
  }
});

const applySchema = z.object({
  niche: z.string().trim().min(1).max(200),
  sequenceId: z.string().min(1).max(60),
  fromStep: z.number().int().min(1).max(50),
  minDaysSinceContact: z.number().int().min(0).max(60).optional(),
  includeUnanswered: z.boolean().optional()
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  assertSameOrigin(req);
  const parsed = applySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Revisa el nicho, la secuencia y el paso");
  try {
    const result = await applyNicheReactivation({ workspaceId: api.workspaceId, ...parsed.data });
    return NextResponse.json({ ok: true, applied: result.applied, ...summarize(result) });
  } catch (error) {
    mapError(error);
  }
});
