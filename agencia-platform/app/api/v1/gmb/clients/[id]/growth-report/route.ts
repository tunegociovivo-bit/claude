/**
 * GET /api/v1/gmb/clients/[id]/growth-report?month=YYYY-MM — informe de crecimiento con datos REALES
 * de la ficha (score, citaciones, rankings, reseñas, contenido, acciones) para un periodo. No inventa
 * datos. Tenant-scoped. Lo consume la vista imprimible.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient, gatherPresenceInput, citationStats } from "@/lib/gmb/server";
import { computePresenceScore } from "@/lib/gmb/presence-score";
import { summarizeReviews } from "@/lib/gmb/review-intel";
import { buildGrowthReport, monthPeriod } from "@/lib/gmb/report";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const monthParam = new URL(req.url).searchParams.get("month");
  const now = new Date();
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const period = monthPeriod(month);
  const from = new Date(period.from), to = new Date(period.to);

  const [presenceInput, cites, positions, reviews, posts, actions] = await Promise.all([
    gatherPresenceInput(prisma, api.workspaceId, client),
    citationStats(prisma, api.workspaceId, client.id),
    prisma.gmbPosition.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { checkedAt: "desc" }, take: 100, select: { keyword: true, avgPosition: true, top3Count: true, cellCount: true, foundCount: true, checkedAt: true } }),
    prisma.gmbReview.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, select: { rating: true, comment: true, reviewReply: true } }),
    prisma.gmbPost.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, select: { status: true, publishedAt: true } }),
    prisma.gmbAction.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, select: { status: true } })
  ]);

  const score = computePresenceScore(presenceInput);
  // Última medición por keyword (para el informe).
  const latest = new Map<string, any>();
  for (const p of positions) if (!latest.has(p.keyword)) latest.set(p.keyword, p);
  const rank = [...latest.values()].map((p: any) => ({ keyword: p.keyword, avgPosition: p.avgPosition ?? null, top3Count: p.top3Count ?? null, visibilityShare: p.cellCount ? Math.round((p.foundCount / p.cellCount) * 100) : null }));

  const rSummary = summarizeReviews(reviews.map((r: any) => ({ rating: r.rating, comment: r.comment, hasReply: !!r.reviewReply })));
  const content = {
    published: posts.filter((p: any) => p.status === "published" && p.publishedAt && new Date(p.publishedAt) >= from && new Date(p.publishedAt) <= to).length,
    scheduled: posts.filter((p: any) => p.status === "scheduled").length,
    drafts: posts.filter((p: any) => p.status === "draft" || p.status === "pending_approval" || p.status === "approved").length
  };
  const actionSummary = { open: actions.filter((a: any) => !["done", "dismissed"].includes(a.status)).length, done: actions.filter((a: any) => a.status === "done").length, total: actions.length };

  const report = buildGrowthReport({
    client: { name: client.name, category: client.category, address: client.address },
    period,
    presence: { score: score.total, breakdown: score.breakdown },
    citations: { total: cites.total, published: cites.published, inconsistent: cites.inconsistent, notFound: cites.notFound },
    rank,
    reviews: { total: rSummary.total, positive: rSummary.sentiment.positive, negative: rSummary.sentiment.negative, avgScore: rSummary.avgScore, pendingResponse: rSummary.pendingResponse },
    content,
    actions: actionSummary
  }, now.toISOString());

  return NextResponse.json({ ok: true, report });
});
