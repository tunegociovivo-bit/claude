import { NextResponse } from "next/server";
import { normalizeSiteUrl } from "@/lib/seo-blog/wp";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { siteOut } from "@/lib/seo-blog/access";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireSeoBlogAccess(api);
  const sites = await prisma.seoBlogSite.findMany({
    where: { workspaceId: api.workspaceId },
    include: { client: { select: { name: true } }, _count: { select: { keywords: true, refs: true } } },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }]
  });
  const counts = await prisma.seoBlogPost.groupBy({
    by: ["siteId", "status"],
    where: { workspaceId: api.workspaceId },
    _count: { _all: true }
  });
  const byStatus = (siteId: string, sts: string[]) =>
    counts.filter((c) => c.siteId === siteId && sts.includes(c.status)).reduce((a, c) => a + c._count._all, 0);
  return NextResponse.json({
    items: sites.map((s) => ({
      ...siteOut(s),
      kwCount: s._count.keywords,
      refCount: s._count.refs,
      ideasCount: byStatus(s.id, ["propuesta"]),
      plannedCount: byStatus(s.id, ["planificada", "en_cola", "generando", "revision", "aprobada", "programada"]),
      publishedCount: byStatus(s.id, ["publicada"])
    }))
  });
});

/** Alta: activa el Publicador SEO para un cliente existente del CRM. */
export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireSeoBlogAccess(api);
  const body = await req.json().catch(() => ({}));
  const clientId = String(body?.clientId ?? "");
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId: api.workspaceId, deletedAt: null } });
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");
  const exists = await prisma.seoBlogSite.findFirst({ where: { workspaceId: api.workspaceId, clientId } });
  if (exists) return NextResponse.json(siteOut({ ...exists, client: { name: client.name } }));
  const site = await prisma.seoBlogSite.create({
    data: {
      workspaceId: api.workspaceId,
      clientId,
      siteUrl: normalizeSiteUrl(client.website ?? ""),
      sector: client.industry ?? "",
      businessInfo: client.brandBrief ?? null,
      competitors: client.competitors ?? null,
      imagesPerPost: 3
    },
    include: { client: { select: { name: true } } }
  });
  return NextResponse.json(siteOut(site), { status: 201 });
});
