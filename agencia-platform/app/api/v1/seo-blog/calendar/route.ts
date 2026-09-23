import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { postLight } from "@/lib/seo-blog/access";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  await requireSeoBlogAccess(api);
  const sp = req.nextUrl.searchParams;
  const from = new Date(sp.get("from") ?? Date.now() - 40 * 86400e3);
  const to = new Date(sp.get("to") ?? Date.now() + 80 * 86400e3);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new ApiError(400, "validation_error", "Rango no válido");
  const where: any = { workspaceId: api.workspaceId, publishAt: { gte: from, lt: to }, status: { not: "descartada" } };
  if (sp.get("siteId")) where.siteId = sp.get("siteId");
  const rows = await prisma.seoBlogPost.findMany({
    where,
    include: { site: { select: { color: true, client: { select: { name: true } } } } },
    orderBy: { publishAt: "asc" }
  });
  return NextResponse.json({ items: rows.map(postLight) });
});
