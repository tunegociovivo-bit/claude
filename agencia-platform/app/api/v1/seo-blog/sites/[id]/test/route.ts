import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { getSiteCtx, sitePages } from "@/lib/seo-blog/service";
import { discoverWpRoot, normalizeSiteUrl, wpTest, WpError } from "@/lib/seo-blog/wp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  let site = await getSiteCtx(api.workspaceId, params.id);
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  let fixedUrl = "";
  const run = async () => {
    const t = await wpTest(site!);
    const pages = await sitePages(site!, true).catch(() => []);
    await prisma.seoBlogSite.updateMany({ where: { id: site!.id, workspaceId: api.workspaceId }, data: { bridgeDetected: t.bridge } });
    return NextResponse.json({ ok: true, ...t, pagesFound: pages.length, ...(fixedUrl ? { fixedUrl, siteUrl: fixedUrl } : {}) });
  };
  try {
    return await run();
  } catch (e: any) {
    // Si la URL no es la raíz del WordPress (p. ej. la página de login o /wp-admin), la descubrimos y reintentamos una vez
    const status = e instanceof WpError ? e.status : 0;
    if (status === 404 || status === 502 || status === 403) {
      const root = await discoverWpRoot(site.siteUrl).catch(() => "");
      if (root && normalizeSiteUrl(root) !== normalizeSiteUrl(site.siteUrl)) {
        fixedUrl = normalizeSiteUrl(root);
        await prisma.seoBlogSite.updateMany({ where: { id: site.id, workspaceId: api.workspaceId }, data: { siteUrl: fixedUrl, siteCacheAt: null } });
        site = { ...site, siteUrl: fixedUrl };
        try {
          return await run();
        } catch (e2: any) {
          return NextResponse.json({ ok: false, fixedUrl, error: `URL corregida a ${fixedUrl}, pero sigue fallando: ${e2?.message ?? String(e2)}` }, { status: 200 });
        }
      }
    }
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 200 });
  }
});
