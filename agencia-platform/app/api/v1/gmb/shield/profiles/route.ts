/** GET /api/v1/gmb/shield/profiles → base de perfiles sospechosos (filtros: level, status, q). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const u = new URL(req.url).searchParams;
  const where: any = { workspaceId: api.workspaceId };
  if (u.get("level")) where.level = u.get("level");
  if (u.get("status")) where.status = u.get("status");
  const q = (u.get("q") || "").trim();
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { contributorId: { contains: q } }];
  const [rows, total, confirmed, multi] = await Promise.all([
    prisma.gmbReviewerProfile.findMany({ where, orderBy: [{ timesFlagged: "desc" }, { maxScore: "desc" }], take: 300 }),
    prisma.gmbReviewerProfile.count({ where: { workspaceId: api.workspaceId } }),
    prisma.gmbReviewerProfile.count({ where: { workspaceId: api.workspaceId, status: "confirmado" } }),
    prisma.gmbReviewerProfile.count({ where: { workspaceId: api.workspaceId, timesFlagged: { gte: 2 } } })
  ]);
  return NextResponse.json({ profiles: rows, totals: { total, confirmed, multi } });
});
