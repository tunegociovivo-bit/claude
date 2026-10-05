import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureSeoSite } from "@/lib/seo-blog/access";
import { parseBody, z } from "@/lib/seo-blog/validate";

export const dynamic = "force-dynamic";

const scalar = z.union([z.string(), z.number(), z.null()]).optional();
const Body = z.object({
  keyword: z.string().optional(),
  kwType: z.enum(["principal", "secundaria", "longtail"]).optional(),
  intent: z.enum(["", "informacional", "comercial", "transaccional", "navegacional", "local"]).optional(),
  notes: z.string().optional(),
  priority: scalar,
  volume: scalar
});

export const PATCH = withApi({ module: "seo" }, async (req, { params, api }) => {
  const site = await ensureSeoSite(api.workspaceId);
  const b = await parseBody(req, Body);
  const data: Record<string, any> = {};
  for (const k of ["keyword", "kwType", "intent", "notes"] as const) if (typeof b[k] === "string") data[k] = b[k]!.trim().slice(0, k === "keyword" ? 250 : 1000);
  if (data.keyword === "") delete data.keyword;
  if (b.priority !== undefined) data.priority = Math.max(1, Math.min(3, Number(b.priority) || 2));
  if (b.volume !== undefined) {
    const v = b.volume === "" || b.volume === null ? null : Math.round(Number(b.volume));
    data.volume = v && Number.isFinite(v) && v > 0 ? Math.min(v, 1e9) : null;
  }
  if ("keyword" in data) data.serp = null;
  const r = await prisma.seoBlogKeyword.updateMany({ where: { id: String(params.id ?? ""), workspaceId: api.workspaceId, siteId: site.id }, data });
  if (!r.count) throw new ApiError(404, "not_found", "No encontrado");
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ module: "seo" }, async (_req, { params, api }) => {
  const site = await ensureSeoSite(api.workspaceId);
  await prisma.seoBlogKeyword.deleteMany({ where: { id: String(params.id ?? ""), workspaceId: api.workspaceId, siteId: site.id } });
  return NextResponse.json({ ok: true });
});
