import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { getSiteCtx, sitePages } from "@/lib/seo-blog/service";
import { wpTest } from "@/lib/seo-blog/wp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const site = await getSiteCtx(api.workspaceId, params.id);
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  try {
    const t = await wpTest(site);
    const pages = await sitePages(site, true).catch(() => []);
    await prisma.seoBlogSite.updateMany({ where: { id: site.id, workspaceId: api.workspaceId }, data: { bridgeDetected: t.bridge } });
    return NextResponse.json({ ok: true, ...t, pagesFound: pages.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 200 });
  }
});
