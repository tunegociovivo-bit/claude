import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { postLight } from "@/lib/seo-blog/access";
import { previewHtml } from "@/lib/seo-blog/pipeline";
import { analyze, extractFaq } from "@/lib/seo-blog/seo";
import { slugify } from "@/lib/seo-blog/util";

export const dynamic = "force-dynamic";

async function full(workspaceId: string, id: string) {
  const p = await prisma.seoBlogPost.findFirst({
    where: { id, workspaceId },
    include: { site: { select: { color: true, language: true, siteUrl: true, leadDays: true, client: { select: { name: true } } } } }
  });
  if (!p) throw new ApiError(404, "not_found", "Post no encontrado");
  const { html, imageUrls } = await previewHtml(p, p.site.language);
  const log = await prisma.seoBlogLog.findMany({ where: { workspaceId, postId: id }, orderBy: { createdAt: "desc" }, take: 80 });
  return {
    ...postLight(p),
    content: p.content,
    metaTitle: p.metaTitle,
    metaDescription: p.metaDescription,
    slug: p.slug,
    category: p.category,
    tags: p.tags ?? [],
    brief: p.brief ?? {},
    images: ((p.images as any[]) ?? []).map((im, i) => ({ ...im, previewUrl: imageUrls[i] ?? null })),
    seoReport: p.seoReport ?? {},
    faq: p.faq ?? [],
    previewHtml: html,
    siteUrl: p.site.siteUrl,
    language: p.site.language,
    leadDays: p.site.leadDays,
    log
  };
}

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  return NextResponse.json(await full(api.workspaceId, params.id));
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const cur = await prisma.seoBlogPost.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, include: { site: true } });
  if (!cur) throw new ApiError(404, "not_found", "Post no encontrado");
  const b = (await req.json().catch(() => ({}))) ?? {};
  const data: Record<string, any> = {};
  for (const k of ["title", "keyword", "metaTitle", "metaDescription", "category", "intent", "funnel"]) if (typeof b[k] === "string") data[k] = b[k].trim().slice(0, 400);
  for (const k of ["notes", "angle"]) if (k in b) data[k] = b[k] == null ? null : String(b[k]).slice(0, 5000);
  if (typeof b.slug === "string") data.slug = slugify(b.slug);
  if (typeof b.content === "string") data.content = b.content.replace(/<script[\s\S]*?<\/script>/gi, "");
  if (Array.isArray(b.tags)) data.tags = b.tags.map(String).slice(0, 10);
  if (Array.isArray(b.secondaryKeywords)) data.secondaryKeywords = b.secondaryKeywords.map(String).slice(0, 20);
  if ("keywordId" in b) data.keywordId = b.keywordId || null;

  const merged = { ...cur, ...data };
  if (["content", "metaTitle", "metaDescription", "keyword", "title", "slug"].some((k) => k in data) && merged.content) {
    const a = analyze(merged as any, cur.site);
    data.seoScore = a.score;
    data.seoReport = a as any;
    data.faq = extractFaq(merged.content ?? "") as any;
  }
  // Si ya estaba programado en la web del cliente → se reenvía con los cambios
  if (cur.status === "programada" && Object.keys(data).length) data.status = "aprobada";
  await prisma.seoBlogPost.updateMany({ where: { id: cur.id, workspaceId: api.workspaceId }, data });
  return NextResponse.json(await full(api.workspaceId, cur.id));
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  await prisma.seoBlogPost.deleteMany({ where: { id: params.id, workspaceId: api.workspaceId } });
  return NextResponse.json({ ok: true });
});
