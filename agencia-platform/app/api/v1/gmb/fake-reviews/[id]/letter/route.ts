/**
 * POST /api/v1/gmb/fake-reviews/[id]/letter → redacta (o regenera) con IA el escrito a soporte de Google
 *      para solicitar la retirada de las reseñas del caso (patrón de interacción falsa + contenido prohibido).
 * PUT  /api/v1/gmb/fake-reviews/[id]/letter {text} → guarda la versión editada.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { complete } from "@/lib/ai/anthropic";
import { buildGoogleCase, fallbackLetter, LETTER_SYSTEM, letterUserPrompt } from "@/lib/gmb/fake-reviews/google";
import { reportBrand } from "@/lib/gmb/fake-reviews/brand";
import type { AnalysisResults } from "@/lib/gmb/fake-reviews/analyzer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function load(id: string, workspaceId: string) {
  const row = await prisma.gmbFakeReviewAnalysis.findFirst({ where: { id, workspaceId }, select: { id: true, status: true, results: true } });
  if (!row) throw new ApiError(404, "not_found", "Análisis no encontrado");
  if (row.status !== "done" || !row.results) throw new ApiError(409, "not_ready", "El análisis aún no ha terminado");
  return { id: row.id, results: row.results as unknown as AnalysisResults };
}

export const POST = withApi({ scope: "ai", rate: "ai" }, async (_req, { params, api }) => {
  const { id, results } = await load(params.id, api.workspaceId);
  const gc = buildGoogleCase(results);
  if (!gc.removals.length) throw new ApiError(422, "nothing_to_request", "No hay reseñas con patrón claro ni con contenido prohibido que reclamar.");
  const brand = await reportBrand(api.workspaceId, api.userId);
  let text: string;
  let ai = true;
  try {
    text = (
      await complete({
        workspaceId: api.workspaceId,
        userId: api.userId ?? null,
        feature: "gmb_fake_reviews_letter",
        maxTokens: 6000,
        system: LETTER_SYSTEM,
        user: letterUserPrompt(results, gc, brand)
      })
    ).trim();
  } catch {
    text = fallbackLetter(results, gc, brand);
    ai = false;
  }
  results.letter = { text, generatedAt: new Date().toISOString() };
  await prisma.gmbFakeReviewAnalysis.updateMany({ where: { id, workspaceId: api.workspaceId }, data: { results: results as any } });
  return NextResponse.json({ letter: results.letter, ai });
});

const putSchema = z.object({ text: z.string().min(20).max(60_000) });

export const PUT = withApi({ scope: "*" }, async (req, { params, api }) => {
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { id, results } = await load(params.id, api.workspaceId);
  results.letter = { text: parsed.data.text, generatedAt: results.letter?.generatedAt ?? new Date().toISOString(), editedAt: new Date().toISOString() };
  await prisma.gmbFakeReviewAnalysis.updateMany({ where: { id, workspaceId: api.workspaceId }, data: { results: results as any } });
  return NextResponse.json({ letter: results.letter });
});
