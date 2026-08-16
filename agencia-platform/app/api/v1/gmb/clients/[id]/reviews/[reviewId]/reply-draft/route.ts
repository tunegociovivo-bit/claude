/**
 * POST /api/v1/gmb/clients/[id]/reviews/[reviewId]/reply-draft — genera y GUARDA un borrador de
 * respuesta a una reseña. NUNCA publica (la publicación externa vía Make es otra acción con
 * aprobación). Riesgo alto o rating bajo fuerzan aprobación humana. Tenant-scoped, idempotente.
 * DELETE limpia el borrador (reversible).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { analyzeReview, decideReply, buildReplyDraft, type ReplyRules } from "@/lib/gmb/review-intel";

export const dynamic = "force-dynamic";

const schema = z.object({ tone: z.string().max(40).optional() });

async function loadReview(workspaceId: string, clientId: string, reviewId: string) {
  return prisma.gmbReview.findFirst({ where: { id: reviewId, workspaceId, clientId } });
}

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const review = await loadReview(api.workspaceId, client.id, (params as any).reviewId);
  if (!review) throw new ApiError(404, "not_found", "Reseña no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const tone = parsed.data.tone ?? client.customTone ?? client.tone ?? "profesional";
  const analysis = analyzeReview({ rating: review.rating, comment: review.comment, hasReply: !!review.reviewReply });
  const rules: ReplyRules = { autoReplyEnabled: client.autoReply === "auto", autoReplyMinRating: 4, neverAutoOnRisk: true };
  const decision = decideReply(analysis, review.rating, rules);
  const draft = buildReplyDraft(analysis, { businessName: client.name, authorName: review.authorName, tone });

  // Guarda el borrador (NO publica). Tenant-scoped.
  await prisma.gmbReview.updateMany({ where: { id: review.id, workspaceId: api.workspaceId }, data: { replyDraft: draft, replyDraftTone: tone, replyDraftAt: new Date() } });

  return NextResponse.json({ ok: true, draft, tone, analysis, decision, note: "Borrador guardado. No se publica automáticamente; requiere revisión/aprobación." });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const review = await loadReview(api.workspaceId, client.id, (params as any).reviewId);
  if (!review) throw new ApiError(404, "not_found", "Reseña no encontrada");
  await prisma.gmbReview.updateMany({ where: { id: review.id, workspaceId: api.workspaceId }, data: { replyDraft: null, replyDraftTone: null, replyDraftAt: null } });
  return NextResponse.json({ ok: true });
});
