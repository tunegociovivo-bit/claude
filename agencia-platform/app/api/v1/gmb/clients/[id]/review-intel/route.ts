/**
 * GET /api/v1/gmb/clients/[id]/review-intel — inteligencia de reseñas sobre la ingestión existente
 * (GmbReview vía Make): sentimiento/temas/urgencia/riesgo/intención + resumen + decisión de respuesta
 * según reglas de la ficha. NUNCA auto-publica: solo clasifica y decide si se puede auto-sugerir.
 * Tenant-scoped. No expone datos crudos sensibles más allá de autor/comentario ya visibles.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { analyzeReview, summarizeReviews, decideReply, type ReplyRules } from "@/lib/gmb/review-intel";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 100), 200);
  const reviews = await prisma.gmbReview.findMany({
    where: { workspaceId: api.workspaceId, clientId: client.id },
    orderBy: { reviewTime: "desc" },
    take: limit,
    select: { id: true, authorName: true, rating: true, comment: true, reviewReply: true, reviewTime: true }
  });

  const rules: ReplyRules = { autoReplyEnabled: client.autoReply === "auto", autoReplyMinRating: 4, neverAutoOnRisk: true };
  const items = reviews.map((r: any) => {
    const analysis = analyzeReview({ rating: r.rating, comment: r.comment, reviewTime: r.reviewTime, hasReply: !!r.reviewReply });
    const reply = decideReply(analysis, r.rating, rules);
    return { id: r.id, authorName: r.authorName, rating: r.rating, comment: r.comment, hasReply: !!r.reviewReply, reviewTime: r.reviewTime, analysis, reply };
  });
  const summary = summarizeReviews(items.map((i: any) => ({ rating: i.rating, comment: i.comment, hasReply: i.hasReply, analysis: i.analysis })));

  return NextResponse.json({ ok: true, rules, summary, items });
});
