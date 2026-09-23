import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { storeReference } from "@/lib/seo-blog/service";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Copia las referencias visuales que el cliente ya tiene en el calendario editorial (Client.referenceImages). */
export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const site = await prisma.seoBlogSite.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, client: { select: { referenceImages: true } } }
  });
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  const refs = Array.isArray(site.client.referenceImages) ? (site.client.referenceImages as any[]) : [];
  let imported = 0;
  const errors: string[] = [];
  for (const r of refs.slice(0, 12)) {
    const url = typeof r === "string" ? r : r?.url;
    if (!url) continue;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await storeReference(api.workspaceId, site.id, Buffer.from(await resp.arrayBuffer()), `editorial-${imported + 1}.jpg`, "editorial");
      imported++;
    } catch (e: any) {
      errors.push(e?.message ?? String(e));
    }
  }
  return NextResponse.json({ imported, found: refs.length, errors: errors.slice(0, 5) });
});
