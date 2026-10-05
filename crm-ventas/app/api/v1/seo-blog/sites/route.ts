import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ensureSeoSite, siteOut } from "@/lib/seo-blog/access";

export const dynamic = "force-dynamic";

async function withCounts(workspaceId: string) {
  const base = await ensureSeoSite(workspaceId);
  const site = await prisma.seoBlogSite.findFirst({
    where: { id: base.id, workspaceId },
    include: { client: { select: { name: true } }, _count: { select: { keywords: true, refs: true } } }
  });
  const counts = await prisma.seoBlogPost.groupBy({
    by: ["status"],
    where: { workspaceId, siteId: base.id },
    _count: { _all: true }
  });
  const byStatus = (sts: string[]) => counts.filter((c) => sts.includes(c.status)).reduce((a, c) => a + c._count._all, 0);
  return {
    ...siteOut(site!),
    kwCount: site!._count.keywords,
    refCount: site!._count.refs,
    ideasCount: byStatus(["propuesta"]),
    plannedCount: byStatus(["planificada", "en_cola", "generando", "revision", "aprobada", "programada"]),
    publishedCount: byStatus(["publicada"])
  };
}

/** La web del negocio (una sola por workspace; se crea sola al primer acceso con los datos de la marca). */
export const GET = withApi({ module: "seo" }, async (_req, { api }) => {
  return NextResponse.json({ items: [await withCounts(api.workspaceId)] });
});

/** Compatibilidad con el Hub: «dar de alta» = asegurar que existe la web del negocio. */
export const POST = withApi({ module: "seo" }, async (_req, { api }) => {
  return NextResponse.json(await withCounts(api.workspaceId));
});
