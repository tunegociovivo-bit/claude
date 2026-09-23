import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { postLight } from "@/lib/seo-blog/access";

export const dynamic = "force-dynamic";

const INCLUDE = { site: { select: { color: true, client: { select: { name: true } } } } } as const;

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  await requireSeoBlogAccess(api);
  const sp = req.nextUrl.searchParams;
  const where: any = { workspaceId: api.workspaceId };
  if (sp.get("siteId")) where.siteId = sp.get("siteId");
  if (sp.get("status")) where.status = { in: sp.get("status")!.split(",").map((s) => s.trim()).filter(Boolean) };
  if (sp.get("search")) where.OR = [{ title: { contains: sp.get("search"), mode: "insensitive" } }, { keyword: { contains: sp.get("search"), mode: "insensitive" } }];
  const rows = await prisma.seoBlogPost.findMany({
    where,
    include: INCLUDE,
    orderBy: [{ publishAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 500
  });
  return NextResponse.json({ items: rows.map(postLight) });
});

/** Post manual (propuesta escrita por el equipo). */
export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireSeoBlogAccess(api);
  const b = (await req.json().catch(() => ({}))) ?? {};
  const site = await prisma.seoBlogSite.findFirst({ where: { id: String(b.siteId ?? ""), workspaceId: api.workspaceId }, select: { id: true } });
  if (!site) throw new ApiError(404, "not_found", "Cliente no encontrado");
  const title = String(b.title ?? "").trim();
  if (!title) throw new ApiError(400, "validation_error", "El título es obligatorio");
  const p = await prisma.seoBlogPost.create({
    data: {
      workspaceId: api.workspaceId,
      siteId: site.id,
      title: title.slice(0, 250),
      keyword: String(b.keyword ?? "").slice(0, 250),
      notes: b.notes ? String(b.notes) : null,
      angle: b.angle ? String(b.angle) : null,
      status: "propuesta",
      createdById: api.userId ?? null
    },
    include: INCLUDE
  });
  return NextResponse.json(postLight(p), { status: 201 });
});
