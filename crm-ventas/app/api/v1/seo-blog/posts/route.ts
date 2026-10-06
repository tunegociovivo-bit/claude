import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureSeoSite, postLight } from "@/lib/seo-blog/access";
import { parseBody, z } from "@/lib/seo-blog/validate";

export const dynamic = "force-dynamic";

const INCLUDE = { site: { select: { color: true } } } as const;
const STATUSES = ["propuesta", "planificada", "en_cola", "generando", "revision", "aprobada", "programada", "publicada", "error", "descartada"];

export const GET = withApi({ module: "seo" }, async (req, { api }) => {
  const site = await ensureSeoSite(api.workspaceId);
  const sp = req.nextUrl.searchParams;
  if (sp.get("siteId") && sp.get("siteId") !== site.id) throw new ApiError(404, "not_found", "No encontrado");
  const where: any = { workspaceId: api.workspaceId, siteId: site.id };
  const st = (sp.get("status") ?? "").split(",").map((s) => s.trim()).filter((s) => STATUSES.includes(s));
  if (st.length) where.status = { in: st };
  const search = (sp.get("search") ?? "").trim().slice(0, 200);
  if (search) where.OR = [{ title: { contains: search, mode: "insensitive" } }, { keyword: { contains: search, mode: "insensitive" } }];
  const rows = await prisma.seoBlogPost.findMany({
    where,
    include: INCLUDE,
    orderBy: [{ publishAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 500
  });
  return NextResponse.json({ items: rows.map(postLight) });
});

const Body = z.object({
  siteId: z.string().optional(),
  title: z.string().max(1000),
  keyword: z.string().max(1000).optional(),
  notes: z.string().max(5000).nullable().optional(),
  angle: z.string().max(5000).nullable().optional()
});

/** Post manual (propuesta escrita por el negocio). Siempre en su única web. */
export const POST = withApi({ module: "seo" }, async (req, { api }) => {
  const site = await ensureSeoSite(api.workspaceId);
  const b = await parseBody(req, Body);
  if (b.siteId && b.siteId !== site.id) throw new ApiError(404, "not_found", "No encontrado");
  const title = b.title.trim();
  if (!title) return NextResponse.json({ error: { code: "validation_error", message: "El título es obligatorio" } }, { status: 400 });
  const p = await prisma.seoBlogPost.create({
    data: {
      workspaceId: api.workspaceId,
      siteId: site.id,
      title: title.slice(0, 250),
      keyword: String(b.keyword ?? "").trim().slice(0, 250),
      notes: b.notes ? String(b.notes) : null,
      angle: b.angle ? String(b.angle) : null,
      status: "propuesta",
      createdById: api.userId ?? null
    },
    include: INCLUDE
  });
  return NextResponse.json(postLight(p), { status: 201 });
});
