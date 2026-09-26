/**
 * GET /api/v1/gmb/shield/cases → centro de retiradas (filtros: status, target, place, q) + recuentos.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const u = new URL(req.url).searchParams;
  const status = u.get("status") || "";
  const target = u.get("target") || "";
  const place = u.get("place") || "";
  const q = (u.get("q") || "").trim();
  const where: any = { workspaceId: api.workspaceId };
  if (status === "abiertas") where.status = { in: ["preparada", "denunciada", "rechazada", "apelada", "legal"] };
  else if (status) where.status = status;
  if (target) where.target = target;
  if (place) where.placeKey = place;
  if (q) where.OR = [{ author: { contains: q, mode: "insensitive" } }, { text: { contains: q, mode: "insensitive" } }, { placeTitle: { contains: q, mode: "insensitive" } }];
  const [rows, counts, places] = await Promise.all([
    prisma.gmbReviewCase.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
      select: {
        id: true, target: true, placeKey: true, placeTitle: true, placeUrl: true, reviewLink: true, author: true, authorLink: true, rating: true, reviewDate: true,
        text: true, reasons: true, score: true, likelihood: true, googleOption: true, status: true, channel: true, reportText: true, appealText: true, legalText: true,
        replyDraft: true, replyPublishedAt: true, appealBatch: true, reportedAt: true, rejectedAt: true, appealedAt: true, removedAt: true, lastCheckedAt: true,
        checkMisses: true, notes: true, createdAt: true, analysisId: true, watchId: true
      }
    }),
    prisma.gmbReviewCase.groupBy({ by: ["status"], where: { workspaceId: api.workspaceId }, _count: true }),
    prisma.gmbReviewCase.groupBy({ by: ["placeKey", "placeTitle"], where: { workspaceId: api.workspaceId }, _count: true })
  ]);
  return NextResponse.json({
    cases: rows,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    places: places.map((p) => ({ key: p.placeKey, title: p.placeTitle, n: p._count })).sort((a, b) => b.n - a.n)
  });
});
