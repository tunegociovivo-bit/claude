/**
 * GET /api/v1/gmb/clients/[id]/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Datos completos del informe de la ficha para un rango de fechas: rendimiento de Google
 * (visualizaciones, búsquedas, interacciones), reseñas del periodo vs. periodo anterior,
 * publicaciones, posicionamiento registrado y branding. Lo consume /gmb-hub/report/[id], que
 * lo presenta en modo «real» o «cliente» (mismos datos, distinta presentación).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { fetchPerformance } from "@/lib/gmb/performance";
import { reviewSyncDue, syncClientReviews } from "@/lib/gmb/review-sync";
import { gbpCall, gbpSourceForClient, gmbLocationPath } from "@/lib/integrations/gmb";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

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

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const ws = api.workspaceId;
  const client = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: ws } });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const url = new URL(req.url);
  const yesterday = new Date(Date.now() - DAY);
  let to = DATE_RE.test(url.searchParams.get("to") ?? "") ? new Date(`${url.searchParams.get("to")}T23:59:59Z`) : yesterday;
  if (to > new Date()) to = new Date();
  let from = DATE_RE.test(url.searchParams.get("from") ?? "") ? new Date(`${url.searchParams.get("from")}T00:00:00Z`) : new Date(to.getTime() - 29 * DAY);
  if (from > to) from = new Date(to.getTime() - 29 * DAY);
  const spanMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs);

  // Reseñas al día antes de calcular (si toca).
  if (await reviewSyncDue(ws, client.id).catch(() => false)) {
    await syncClientReviews(ws, client.id, { maxPages: 4 }).catch(() => undefined);
  }

  const source = gbpSourceForClient(client);
  const path = gmbLocationPath(client.accountId, client.locationId);

  const [perf, allReviews, dbPosts, positions, wsRow, googlePosts] = await Promise.all([
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
    })().catch(() => null)
  ]);

  const inRange = (d: Date | null, a: Date, b: Date) => !!d && d >= a && d <= b;
  const periodReviews = allReviews.filter((r) => inRange(r.reviewTime, from, to));
  const prevReviews = allReviews.filter((r) => inRange(r.reviewTime, prevFrom, prevTo));
  const cur = reviewStats(periodReviews);
  const prev = reviewStats(prevReviews);
  const overall = reviewStats(allReviews);

  // Evolución mensual (últimos 12 meses hasta el fin del periodo).
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

  // Publicaciones: las de Google en el periodo (incluye las hechas fuera del Hub) o, si no hay acceso, las del Hub.
  const gPosts = (googlePosts ?? [])
    .filter((p: any) => p.createTime && inRange(new Date(p.createTime), from, to))
    .map((p: any) => ({
      date: p.createTime,
      text: String(p.summary ?? p.event?.title ?? "").slice(0, 220),
      image: p.media?.[0]?.googleUrl ?? null,
      type: p.topicType ?? "STANDARD"
    }));
  const posts = googlePosts
    ? gPosts
    : dbPosts.map((p) => ({ date: p.publishedAt, text: (p.title || p.content).slice(0, 220), image: p.imageUrl, type: "STANDARD" }));
  const prevPostsCount = (googlePosts ?? []).filter((p: any) => p.createTime && inRange(new Date(p.createTime), prevFrom, prevTo)).length;

  // Posicionamiento (rejilla): última medición por palabra clave dentro del periodo y la anterior.
  const byKw = new Map<string, typeof positions>();
  for (const p of positions) {
    const l = byKw.get(p.keyword) ?? [];
    l.push(p);
    byKw.set(p.keyword, l);
  }
  const ranking = [...byKw.entries()].map(([keyword, list]) => {
    const last = list[0];
    const before = list.find((x) => x.checkedAt < from) ?? null;
    const vis = (x: any) => (x?.cellCount ? Math.round((x.foundCount / x.cellCount) * 100) : null);
    return {
      keyword,
      checkedAt: last.checkedAt,
      avgPosition: last.avgPosition || null,
      top3Share: last.cellCount ? Math.round((last.top3Count / last.cellCount) * 100) : null,
      visibility: vis(last),
      prevAvgPosition: before?.avgPosition || null,
      prevVisibility: vis(before)
    };
  });

  const branding: any = (wsRow?.settings as any)?.branding ?? {};
  return NextResponse.json({
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
    branding: { name: branding.name ?? wsRow?.name ?? "", logoUrl: branding.logoUrl ?? null, color: branding.color ?? null },
    period: { from: isoDay(from), to: isoDay(to), prevFrom: isoDay(prevFrom), prevTo: isoDay(prevTo), days: Math.round(spanMs / DAY) + 1 },
    performance: perf,
    reviews: {
      period: cur,
      previous: prev,
      overall,
      monthly,
      list: periodReviews.slice(0, 60).map((r) => ({ author: r.authorName, rating: r.rating, comment: r.comment, reply: r.reviewReply, time: r.reviewTime })),
      bestOverall: allReviews
        .filter((r) => r.rating === 5 && (r.comment ?? "").length > 40)
        .slice(0, 6)
        .map((r) => ({ author: r.authorName, rating: r.rating, comment: r.comment, reply: r.reviewReply, time: r.reviewTime }))
    },
    posts: { count: posts.length, previous: googlePosts ? prevPostsCount : null, list: posts.slice(0, 12), source: googlePosts ? "google" : "hub" },
    ranking,
    generatedAt: new Date().toISOString()
  });
});
