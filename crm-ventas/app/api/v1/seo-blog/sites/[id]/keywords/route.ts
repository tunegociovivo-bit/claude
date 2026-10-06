import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireOwnSite } from "@/lib/seo-blog/access";
import { parseBody, z } from "@/lib/seo-blog/validate";

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

export const GET = withApi({ module: "seo" }, async (_req, { params, api }) => {
  const site = await requireOwnSite(api, params.id);
  return NextResponse.json({ items: await list(api.workspaceId, site.id) });
});

const scalar = z.union([z.string(), z.number(), z.null()]).optional();
const Item = z
  .object({
    keyword: z.union([z.string(), z.number()]).optional(),
    priority: scalar,
    volume: scalar,
    kwType: z.string().max(40).optional(),
    kw_type: z.string().max(40).optional(),
    intent: z.string().max(40).optional(),
    notes: z.string().max(2000).nullable().optional(),
    why: z.string().max(2000).nullable().optional()
  })
  .passthrough();
const Body = z
  .object({
    bulk: z.string().max(200_000).optional(),
    items: z.array(Item).max(500).optional(),
    keyword: z.union([z.string(), z.number()]).optional()
  })
  .passthrough();

const KW_TYPES = ["principal", "secundaria", "longtail"];
const INTENTS = ["", "informacional", "comercial", "transaccional", "navegacional", "local"];

/**
 * Alta de palabras clave. Acepta:
 *  - { keyword, priority?, volume?, kwType?, intent?, notes? }
 *  - { bulk: "kw | prioridad | volumen\n..." }
 *  - { items: [{ keyword, kw_type, intent, priority, why }] }  (sugerencias IA)
 */
export const POST = withApi({ module: "seo" }, async (req, { params, api }) => {
  const site = await requireOwnSite(api, params.id);
  const b = (await parseBody(req, Body)) as any;
  let items: any[] = [];
  if (typeof b.bulk === "string") {
    for (const line of b.bulk.split(/\r?\n/)) {
      const [kw, prio, vol] = line.split("|").map((x: string) => x.trim());
      if (kw) items.push({ keyword: kw, priority: Number(prio) || 2, volume: vol ? Number(vol) : null });
    }
  } else if (Array.isArray(b.items)) items = b.items;
  else if (b.keyword) items = [Item.parse(b)];
  items = items.slice(0, 500);

  const existing = new Set(
    (await prisma.seoBlogKeyword.findMany({ where: { workspaceId: api.workspaceId, siteId: site.id }, select: { keyword: true } })).map((k) => k.keyword.toLowerCase())
  );
  let added = 0;
  for (const it of items) {
    const keyword = String(it.keyword ?? "").trim().slice(0, 250);
    if (!keyword || existing.has(keyword.toLowerCase())) continue;
    const kwType = String(it.kwType ?? it.kw_type ?? "principal");
    const intent = String(it.intent ?? "");
    const vol = it.volume === null || it.volume === undefined || it.volume === "" ? null : Math.round(Number(it.volume));
    await prisma.seoBlogKeyword.create({
      data: {
        workspaceId: api.workspaceId,
        siteId: site.id,
        keyword,
        kwType: KW_TYPES.includes(kwType) ? kwType : "principal",
        intent: INTENTS.includes(intent) ? intent : "",
        priority: Math.max(1, Math.min(3, Number(it.priority) || 2)),
        volume: vol && Number.isFinite(vol) && vol > 0 ? Math.min(vol, 1e9) : null,
        notes: it.notes ?? it.why ?? null
      }
    });
    existing.add(keyword.toLowerCase());
    added++;
  }
  return NextResponse.json({ added, items: await list(api.workspaceId, site.id) });
});
