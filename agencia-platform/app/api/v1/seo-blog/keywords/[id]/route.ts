import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";

export const dynamic = "force-dynamic";

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const b = (await req.json().catch(() => ({}))) ?? {};
  const data: Record<string, any> = {};
  for (const k of ["keyword", "kwType", "intent", "notes"]) if (typeof b[k] === "string") data[k] = b[k].trim().slice(0, 1000);
  if ("priority" in b) data.priority = Math.max(1, Math.min(3, Number(b.priority) || 2));
  if ("volume" in b) data.volume = b.volume === "" || b.volume === null ? null : Math.round(Number(b.volume)) || null;
  if ("keyword" in data) data.serp = null;
  const r = await prisma.seoBlogKeyword.updateMany({ where: { id: params.id, workspaceId: api.workspaceId }, data });
  if (!r.count) throw new ApiError(404, "not_found", "No encontrado");
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  await prisma.seoBlogKeyword.deleteMany({ where: { id: params.id, workspaceId: api.workspaceId } });
  return NextResponse.json({ ok: true });
});
