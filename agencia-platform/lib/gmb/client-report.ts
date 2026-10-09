/**
 * Datos del informe de una ficha para un rango de fechas: rendimiento de Google, reseñas del
 * periodo vs. periodo anterior, publicaciones, posicionamiento y (opcional) el último análisis
 * de reseñas falsas. Lo usan la página /gmb-hub/report/[id] y la descarga en PDF.
 */
import { prisma } from "@/lib/db/prisma";
import { fetchPerformance } from "@/lib/gmb/performance";
import { reviewSyncDue, syncClientReviews } from "@/lib/gmb/review-sync";
import { gbpCall, gbpSourceForClient, gmbLocationPath } from "@/lib/integrations/gmb";
import { normName } from "@/lib/gmb/competitor-ranking";

const DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function reviewStats(list: { rating: number; reviewReply: string | null }[]) {
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let replied = 0;
  for (const r of list) {
    if (r.rating >= 1 && r.rating <= 5) dist[r.rating]++;
    sum += r.rating;
    if (r.reviewReply) replied++;
  }
  const total = list.length;
  return {
    total,
    avg: total ? Number((sum / total).toFixed(2)) : 0,
    distribution: dist,
    replied,
    unreplied: total - replied,
    responseRate: total ? Math.round((replied / total) * 100) : 0,
    positive: dist[4] + dist[5],
    negative: dist[1] + dist[2]
  };
}

/** Resumen del último análisis de reseñas falsas terminado para esta ficha. */
export async function fakeReviewSummary(workspaceId: string, client: { id: string; name: string; placeId: string }) {
  const rows = await prisma.gmbFakeReviewAnalysis.findMany({
    where: { workspaceId, status: "done", OR: [{ clientId: client.id }, { clientName: client.name }] },
    orderBy: { finishedAt: "desc" },
    take: 10,
    select: { id: true, clientId: true, clientName: true, label: true, finishedAt: true, createdAt: true, results: true }
  });
  const want = normName(client.name);
  const row =
    rows.find((r) => r.clientId === client.id) ??
    rows.find((r) => {
      const c = (r.results as any)?.client;
      return (client.placeId && c?.placeId === client.placeId) || normName(c?.title ?? r.clientName) === want;
    });
  if (!row) return null;
  const res: any = row.results ?? {};
  const authors: any[] = Array.isArray(res.authors) ? res.authors : [];
  const policy: any[] = Array.isArray(res.policy?.findings) ? res.policy.findings : [];
  const suspects = authors
    .filter((a) => a.level === "alto" || a.level === "medio")
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map((a) => ({
      name: a.name,
      level: a.level,
      score: a.score,
      link: a.link,
      totalReviews: a.totalReviews,
      signals: (a.signals ?? []).filter((s: any) => s.points > 0).slice(0, 4).map((s: any) => s.label),
      review: a.clientReviews?.[0] ? { rating: a.clientReviews[0].rating, date: a.clientReviews[0].date, text: String(a.clientReviews[0].text ?? "").slice(0, 280) } : null
    }));
  const removable = policy
    .slice()
    .sort((a, b) => ["alta", "media", "baja"].indexOf(a.likelihood) - ["alta", "media", "baja"].indexOf(b.likelihood))
    .slice(0, 20)
    .map((f) => ({
      author: f.author,
      rating: f.rating,
      date: f.date,
      text: String(f.text ?? "").slice(0, 280),
      likelihood: f.likelihood,
      summary: f.summary,
      reasons: (f.violations ?? []).map((v: any) => String(v.category ?? "")).filter(Boolean),
      link: f.link
    }));
  return {
    id: row.id,
    label: row.label || row.clientName,
    date: (row.finishedAt ?? row.createdAt).toISOString(),
    stats: {
      negativesAnalyzed: res.stats?.clientNeg ?? null,
      high: res.stats?.high ?? 0,
      medium: res.stats?.medium ?? 0,
      low: res.stats?.low ?? 0,
      similarPairs: res.stats?.similarPairs ?? 0,
      networks: Array.isArray(res.networks) ? res.networks.length : 0,
      knownMatches: res.knownMatches ?? 0,
      removable: policy.length,
      removableHigh: policy.filter((f) => f.likelihood === "alta").length,
      competitorFakes: Array.isArray(res.compFakes) ? res.compFakes.reduce((s: number, c: any) => s + (c.suspicious?.length ?? 0), 0) : 0
    },
    impact: res.impact?.client ?? null,
    findings: Array.isArray(res.findings) ? res.findings.slice(0, 8) : [],
    aiSummary: typeof res.aiSummary === "string" ? res.aiSummary : null,
    suspects,
    removable
  };
}

export type ClientReport = Awaited<ReturnType<typeof buildClientReport>>;

export async function buildClientReport(workspaceId: string, clientId: string, opts: { from?: string | null; to?: string | null; includeFake?: boolean }) {
  const ws = workspaceId;
  const client = await prisma.gmbClient.findFirst({ where: { id: clientId, workspaceId: ws } });
  if (!client) return null;

  const yesterday = new Date(Date.now() - DAY);
  let to = DATE_RE.test(opts.to ?? "") ? new Date(`${opts.to}T23:59:59Z`) : yesterday;
  if (to > new Date()) to = new Date();
  let from = DATE_RE.test(opts.from ?? "") ? new Date(`${opts.from}T00:00:00Z`) : new Date(to.getTime() - 29 * DAY);
  if (from > to) from = new Date(to.getTime() - 29 * DAY);
  const spanMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs);

  if (await reviewSyncDue(ws, client.id).catch(() => false)) {
    await syncClientReviews(ws, client.id, { maxPages: 4 }).catch(() => undefined);
  }

  const source = gbpSourceForClient(client);
  const path = gmbLocationPath(client.accountId, client.locationId);

  const [perf, allReviews, dbPosts, positions, wsRow, googlePosts, fake] = await Promise.all([
    fetchPerformance(ws, client, { since: isoDay(from), until: isoDay(to) })
      .then((d) => ({ ok: true as const, ...d }))
      .catch((e: any) => ({ ok: false as const, message: String(e?.message ?? e).slice(0, 300) })),
    prisma.gmbReview.findMany({
      where: { workspaceId: ws, clientId: client.id },
      orderBy: { reviewTime: "desc" },
      select: { authorName: true, rating: true, comment: true, reviewReply: true, reviewTime: true }
    }),
    prisma.gmbPost.findMany({
      where: { workspaceId: ws, clientId: client.id, status: "published", publishedAt: { gte: from, lte: to } },
      select: { title: true, content: true, publishedAt: true, imageUrl: true }
    }),
    prisma.gmbPosition.findMany({
      where: { workspaceId: ws, clientId: client.id, checkedAt: { lte: to } },
      orderBy: { checkedAt: "desc" },
      take: 200,
      select: { keyword: true, avgPosition: true, top3Count: true, foundCount: true, cellCount: true, checkedAt: true }
    }),
    prisma.workspace.findUnique({ where: { id: ws }, select: { name: true, settings: true } }),
    (async () => {
      if (!path) return null;
      const out: any[] = [];
      let token = "";
      for (let i = 0; i < 4; i++) {
        const qs = new URLSearchParams({ pageSize: "100" });
        if (token) qs.set("pageToken", token);
        const d = await gbpCall(ws, source, { api: "v4", path: `/v4/${path}/localPosts?${qs}` });
        out.push(...(d?.localPosts ?? []));
        token = d?.nextPageToken ?? "";
        if (!token) break;
        const last = out[out.length - 1]?.createTime;
        if (last && new Date(last) < from) break;
      }
      return out;
    })().catch(() => null),
    opts.includeFake ? fakeReviewSummary(ws, client).catch(() => null) : Promise.resolve(undefined)
  ]);

  const inRange = (d: Date | null, a: Date, b: Date) => !!d && d >= a && d <= b;
  const periodReviews = allReviews.filter((r) => inRange(r.reviewTime, from, to));
  const prevReviews = allReviews.filter((r) => inRange(r.reviewTime, prevFrom, prevTo));

  const monthsMap = new Map<string, { count: number; sum: number }>();
  const startMonths = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
  for (const r of allReviews) {
    if (!r.reviewTime || r.reviewTime < startMonths || r.reviewTime > to) continue;
    const m = r.reviewTime.toISOString().slice(0, 7);
    const c = monthsMap.get(m) ?? { count: 0, sum: 0 };
    c.count++;
    c.sum += r.rating;
    monthsMap.set(m, c);
  }
  const monthly: { month: string; count: number; avg: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(startMonths.getUTCFullYear(), startMonths.getUTCMonth() + i, 1));
    const m = d.toISOString().slice(0, 7);
    const c = monthsMap.get(m);
    monthly.push({ month: m, count: c?.count ?? 0, avg: c?.count ? Number((c.sum / c.count).toFixed(1)) : 0 });
  }

  const gPosts = (googlePosts ?? [])
    .filter((p: any) => p.createTime && inRange(new Date(p.createTime), from, to))
    .map((p: any) => ({ date: p.createTime as string, text: String(p.summary ?? p.event?.title ?? "").slice(0, 220), image: (p.media?.[0]?.googleUrl ?? null) as string | null, type: p.topicType ?? "STANDARD" }));
  const posts = googlePosts
    ? gPosts
    : dbPosts.map((p) => ({ date: p.publishedAt?.toISOString() ?? "", text: (p.title || p.content).slice(0, 220), image: p.imageUrl, type: "STANDARD" }));
  const prevPostsCount = (googlePosts ?? []).filter((p: any) => p.createTime && inRange(new Date(p.createTime), prevFrom, prevTo)).length;

  const byKw = new Map<string, typeof positions>();
  for (const p of positions) {
    const l = byKw.get(p.keyword) ?? [];
    l.push(p);
    byKw.set(p.keyword, l);
  }
  const vis = (x: any) => (x?.cellCount ? Math.round((x.foundCount / x.cellCount) * 100) : null);
  const ranking = [...byKw.entries()].map(([keyword, list]) => {
    const last = list[0];
    const before = list.find((x) => x.checkedAt < from) ?? null;
    return {
      keyword,
      checkedAt: last.checkedAt.toISOString(),
      avgPosition: last.avgPosition || null,
      top3Share: last.cellCount ? Math.round((last.top3Count / last.cellCount) * 100) : null,
      visibility: vis(last),
      prevAvgPosition: before?.avgPosition || null,
      prevVisibility: vis(before)
    };
  });

  const toItem = (r: (typeof allReviews)[number]) => ({ author: r.authorName, rating: r.rating, comment: r.comment, reply: r.reviewReply, time: r.reviewTime?.toISOString() ?? null });
  const branding: any = (wsRow?.settings as any)?.branding ?? {};
  return {
    client: {
      name: client.name,
      category: client.category,
      address: client.address,
      phone: client.phone,
      website: client.website,
      mainKeyword: client.mainKeyword,
      rating: client.rating,
      reviewCount: client.reviewCount
    },
    branding: { name: (branding.name ?? wsRow?.name ?? "") as string, logoUrl: (branding.logoUrl ?? null) as string | null, color: (branding.color ?? null) as string | null },
    period: { from: isoDay(from), to: isoDay(to), prevFrom: isoDay(prevFrom), prevTo: isoDay(prevTo), days: Math.round(spanMs / DAY) + 1 },
    performance: perf as any,
    reviews: {
      period: reviewStats(periodReviews),
      previous: reviewStats(prevReviews),
      overall: reviewStats(allReviews),
      monthly,
      list: periodReviews.slice(0, 60).map(toItem),
      bestOverall: allReviews.filter((r) => r.rating === 5 && (r.comment ?? "").length > 40).slice(0, 6).map(toItem)
    },
    posts: { count: posts.length, previous: googlePosts ? prevPostsCount : null, list: posts.slice(0, 12), source: googlePosts ? "google" : "hub" },
    ranking,
    /** undefined = no pedido; null = pedido pero no hay análisis para la ficha. */
    fake,
    generatedAt: new Date().toISOString()
  };
}
