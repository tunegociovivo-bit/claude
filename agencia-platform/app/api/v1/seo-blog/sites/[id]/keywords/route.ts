import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";

export const dynamic = "force-dynamic";

function kwOut(k: any) {
  const serp = (k.serp ?? {}) as any;
  const { serp: _s, ...rest } = k;
  return { ...rest, paa: (serp.paa ?? []).slice(0, 6), related: (serp.related ?? []).slice(0, 8) };
}

async function list(workspaceId: string, siteId: string) {
  const rows = await prisma.seoBlogKeyword.findMany({ where: { workspaceId, siteId }, orderBy: [{ priority: "asc" }, { keyword: "asc" }] });
  return rows.map(kwOut);
}

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  return NextResponse.json({ items: await list(api.workspaceId, params.id) });
});

/**
 * Alta de palabras clave. Acepta:
 *  - { keyword, priority?, volume?, kwType?, intent?, notes? }
 *  - { bulk: "kw | prioridad | volumen\n..." }
 *  - { items: [{ keyword, kw_type, intent, priority, why }] }  (sugerencias IA)
 */
export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const site = await prisma.seoBlogSite.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  const b = (await req.json().catch(() => ({}))) ?? {};
  let items: any[] = [];
  if (typeof b.bulk === "string") {
    for (const line of b.bulk.split(/\r?\n/)) {
      const [kw, prio, vol] = line.split("|").map((x: string) => x.trim());
      if (kw) items.push({ keyword: kw, priority: Number(prio) || 2, volume: vol ? Number(vol) : null });
    }
  } else if (Array.isArray(b.items)) items = b.items;
  else if (b.keyword) items = [b];

  const existing = new Set(
    (await prisma.seoBlogKeyword.findMany({ where: { workspaceId: api.workspaceId, siteId: site.id }, select: { keyword: true } })).map((k) => k.keyword.toLowerCase())
  );
  let added = 0;
  for (const it of items) {
    const keyword = String(it.keyword ?? "").trim().slice(0, 250);
    if (!keyword || existing.has(keyword.toLowerCase())) continue;
    await prisma.seoBlogKeyword.create({
      data: {
        workspaceId: api.workspaceId,
        siteId: site.id,
        keyword,
        kwType: String(it.kwType ?? it.kw_type ?? "principal"),
        intent: String(it.intent ?? ""),
        priority: Math.max(1, Math.min(3, Number(it.priority) || 2)),
        volume: it.volume === null || it.volume === undefined || it.volume === "" ? null : Math.round(Number(it.volume)) || null,
        notes: it.notes ?? it.why ?? null
      }
    });
    existing.add(keyword.toLowerCase());
    added++;
  }
  return NextResponse.json({ added, items: await list(api.workspaceId, site.id) });
});
