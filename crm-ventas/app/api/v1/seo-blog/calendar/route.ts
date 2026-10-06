import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureSeoSite, postLight } from "@/lib/seo-blog/access";

export const dynamic = "force-dynamic";

export const GET = withApi({ module: "seo" }, async (req, { api }) => {
  const site = await ensureSeoSite(api.workspaceId);
  const sp = req.nextUrl.searchParams;
  if (sp.get("siteId") && sp.get("siteId") !== site.id) throw new ApiError(404, "not_found", "No encontrado");
  const from = new Date(sp.get("from") ?? Date.now() - 40 * 86400e3);
  const to = new Date(sp.get("to") ?? Date.now() + 80 * 86400e3);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new ApiError(400, "validation_error", "Rango no válido");
  if (to.getTime() - from.getTime() > 400 * 86400e3) throw new ApiError(400, "validation_error", "Rango demasiado amplio");
  const rows = await prisma.seoBlogPost.findMany({
    where: { workspaceId: api.workspaceId, siteId: site.id, publishAt: { gte: from, lt: to }, status: { not: "descartada" } },
    include: { site: { select: { color: true } } },
    orderBy: { publishAt: "asc" }
  });
  return NextResponse.json({ items: rows.map(postLight) });
});
