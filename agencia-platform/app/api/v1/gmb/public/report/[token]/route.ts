/**
 * GET /api/v1/gmb/public/report/[token] — informe white-label PÚBLICO por token.
 * Valida hash/expiración/revocación; aplica branding del workspace; redacta PII por defecto.
 * No requiere sesión (token-based). Rate-limited. Nunca expone claves ni datos crudos sensibles.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";
import { hashToken, isShareValid, redactReportForShare } from "@/lib/gmb/report-share";
import { gatherPresenceInput, citationStats } from "@/lib/gmb/server";
import { computePresenceScore } from "@/lib/gmb/presence-score";
import { summarizeReviews } from "@/lib/gmb/review-intel";
import { buildGrowthReport, monthPeriod } from "@/lib/gmb/report";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const rl = rateLimitPublic(req as any, { tag: "gmb-report", limit: 60 });
  if (rl && (rl as any).ok === false) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const token = (params?.token ?? "").trim();
  if (!token) return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
  const share = await prisma.gmbReportShare.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!share) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const valid = isShareValid(share, new Date());
  if (!valid.valid) return NextResponse.json({ ok: false, error: valid.reason }, { status: 410 });

  const [client, ws] = await Promise.all([
    prisma.gmbClient.findFirst({ where: { id: share.clientId, workspaceId: share.workspaceId } }),
    prisma.workspace.findUnique({ where: { id: share.workspaceId }, select: { name: true, settings: true } })
  ]);
  if (!client) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const month = share.month && /^\d{4}-\d{2}$/.test(share.month) ? share.month : (() => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; })();
  const period = monthPeriod(month);
  const from = new Date(period.from), to = new Date(period.to);

  const [presenceInput, cites, positions, reviews, posts, actions] = await Promise.all([
    gatherPresenceInput(prisma, share.workspaceId, client),
    citationStats(prisma, share.workspaceId, client.id),
    prisma.gmbPosition.findMany({ where: { workspaceId: share.workspaceId, clientId: client.id }, orderBy: { checkedAt: "desc" }, take: 100, select: { keyword: true, avgPosition: true, top3Count: true, cellCount: true, foundCount: true } }),
    prisma.gmbReview.findMany({ where: { workspaceId: share.workspaceId, clientId: client.id }, select: { rating: true, comment: true, reviewReply: true } }),
    prisma.gmbPost.findMany({ where: { workspaceId: share.workspaceId, clientId: client.id }, select: { status: true, publishedAt: true } }),
    prisma.gmbAction.findMany({ where: { workspaceId: share.workspaceId, clientId: client.id }, select: { status: true } })
  ]);

  const score = computePresenceScore(presenceInput);
  const latest = new Map<string, any>();
  for (const p of positions) if (!latest.has(p.keyword)) latest.set(p.keyword, p);
  const rank = [...latest.values()].map((p: any) => ({ keyword: p.keyword, avgPosition: p.avgPosition ?? null, top3Count: p.top3Count ?? null, visibilityShare: p.cellCount ? Math.round((p.foundCount / p.cellCount) * 100) : null }));
  const rSummary = summarizeReviews(reviews.map((r: any) => ({ rating: r.rating, comment: r.comment, hasReply: !!r.reviewReply })));
  const content = { published: posts.filter((p: any) => p.status === "published" && p.publishedAt && new Date(p.publishedAt) >= from && new Date(p.publishedAt) <= to).length, scheduled: posts.filter((p: any) => p.status === "scheduled").length, drafts: posts.filter((p: any) => ["draft", "pending_approval", "approved"].includes(p.status)).length };
  const actionSummary = { open: actions.filter((a: any) => !["done", "dismissed"].includes(a.status)).length, done: actions.filter((a: any) => a.status === "done").length, total: actions.length };

  const report = buildGrowthReport({
    client: { name: client.name, category: client.category, address: client.address },
    period,
    presence: { score: score.total, breakdown: score.breakdown },
    citations: { total: cites.total, published: cites.published, inconsistent: cites.inconsistent, notFound: cites.notFound },
    rank, reviews: { total: rSummary.total, positive: rSummary.sentiment.positive, negative: rSummary.sentiment.negative, avgScore: rSummary.avgScore, pendingResponse: rSummary.pendingResponse },
    content, actions: actionSummary
  }, new Date().toISOString());

  const branding: any = (ws?.settings as any)?.branding ?? {};
  const safeReport = redactReportForShare(report, share.includePII);
  return NextResponse.json({ ok: true, branding: { name: branding.name ?? ws?.name ?? "Informe", logoUrl: branding.logoUrl ?? null, color: branding.color ?? "#F4600C" }, report: safeReport, includePII: share.includePII });
}
