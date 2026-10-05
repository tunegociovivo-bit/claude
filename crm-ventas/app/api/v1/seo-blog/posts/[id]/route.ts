import { cleanupSeoPostFiles } from "@/lib/content/cleanup";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureSeoSite, postLight } from "@/lib/seo-blog/access";
import { previewHtml } from "@/lib/seo-blog/pipeline";
import { analyze, buildSchema, extractFaq } from "@/lib/seo-blog/seo";
import { replaceFaqSection } from "@/lib/seo-blog/faq";
import { asArray } from "@/lib/seo-blog/util";
import { slugify } from "@/lib/seo-blog/util";
import { parseBody, z } from "@/lib/seo-blog/validate";

export const dynamic = "force-dynamic";

async function full(workspaceId: string, siteId: string, id: string) {
  const p = await prisma.seoBlogPost.findFirst({
    where: { id, workspaceId, siteId },
    include: { site: { select: { color: true, language: true, siteUrl: true, leadDays: true, location: true, client: { select: { name: true } } } } }
  });
  if (!p) throw new ApiError(404, "not_found", "Post no encontrado");
  const { html, imageUrls } = await previewHtml(p, p.site.language);
  // Schema que se enviará a WordPress (el definitivo se guarda al publicar, con la URL real de la portada).
  const imgs = asArray<any>(p.images);
  const schemaPreview = p.content
    ? buildSchema(
        p,
        { siteUrl: p.site.siteUrl, language: p.site.language, location: p.site.location, clientName: p.site.client.name },
        imgs[0]?.remoteFull || (imgs[0]?.status === "done" ? "%%imagen_portada%%" : ""),
        asArray<{ q: string; a: string }>(p.faq)
      )
    : null;
  const log = await prisma.seoBlogLog.findMany({ where: { workspaceId, postId: id }, orderBy: { createdAt: "desc" }, take: 80 });
  return {
    ...postLight(p),
    content: p.content,
    metaTitle: p.metaTitle,
    metaDescription: p.metaDescription,
    slug: p.slug,
    excerpt: p.excerpt ?? "",
    category: p.category,
    tags: p.tags ?? [],
    brief: p.brief ?? {},
    images: ((p.images as any[]) ?? []).map((im, i) => ({ ...im, previewUrl: imageUrls[i] ?? null })),
    seoReport: p.seoReport ?? {},
    faq: p.faq ?? [],
    schemaJson: p.schemaJson ?? schemaPreview,
    schemaSent: !!p.schemaJson,
    previewHtml: html,
    siteUrl: p.site.siteUrl,
    language: p.site.language,
    leadDays: p.site.leadDays,
    log
  };
}

export const GET = withApi({ module: "seo" }, async (_req, { params, api }) => {
  const site = await ensureSeoSite(api.workspaceId);
  return NextResponse.json(await full(api.workspaceId, site.id, String(params.id ?? "")));
});

const Faq = z.array(z.object({ q: z.string().max(500), a: z.string().max(3000) })).max(30);
const Body = z.object({
  title: z.string().optional(),
  keyword: z.string().optional(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  category: z.string().optional(),
  intent: z.string().optional(),
  funnel: z.string().optional(),
  notes: z.string().nullable().optional(),
  angle: z.string().nullable().optional(),
  slug: z.string().optional(),
  excerpt: z.string().nullable().optional(),
  content: z.string().max(400_000).optional(),
  tags: z.array(z.union([z.string(), z.number()])).optional(),
  secondaryKeywords: z.array(z.union([z.string(), z.number()])).optional(),
  keywordId: z.string().nullable().optional(),
  faq: Faq.optional(),
  /** Textos SEO de las imágenes (alt, título, leyenda) por índice. */
  imageMeta: z
    .array(z.object({ index: z.number().int().min(0).max(5), alt: z.string().max(250).optional(), title: z.string().max(250).optional(), caption: z.string().max(500).optional() }))
    .max(6)
    .optional()
});

export const PATCH = withApi({ module: "seo" }, async (req, { params, api }) => {
  const site = await ensureSeoSite(api.workspaceId);
  const cur = await prisma.seoBlogPost.findFirst({ where: { id: String(params.id ?? ""), workspaceId: api.workspaceId, siteId: site.id }, include: { site: true } });
  if (!cur) throw new ApiError(404, "not_found", "Post no encontrado");
  const b = await parseBody(req, Body);
  const data: Record<string, any> = {};
  for (const k of ["title", "keyword", "metaTitle", "metaDescription", "category", "intent", "funnel"] as const) if (typeof b[k] === "string") data[k] = b[k]!.trim().slice(0, 400);
  for (const k of ["notes", "angle"] as const) if (b[k] !== undefined) data[k] = b[k] == null ? null : String(b[k]).slice(0, 5000);
  if (b.excerpt !== undefined) data.excerpt = b.excerpt == null ? null : String(b.excerpt).trim().slice(0, 1000);
  if (typeof b.slug === "string") data.slug = slugify(b.slug);
  if (typeof b.content === "string") data.content = b.content.replace(/<script[\s\S]*?<\/script>/gi, "");
  if (Array.isArray(b.tags)) data.tags = b.tags.map((t) => String(t).trim().slice(0, 80)).filter(Boolean).slice(0, 10);
  if (Array.isArray(b.secondaryKeywords)) data.secondaryKeywords = b.secondaryKeywords.map((t) => String(t).trim().slice(0, 200)).filter(Boolean).slice(0, 20);
  if (b.keywordId !== undefined) {
    if (!b.keywordId) data.keywordId = null;
    else {
      const kw = await prisma.seoBlogKeyword.findFirst({ where: { id: b.keywordId, workspaceId: api.workspaceId, siteId: site.id }, select: { id: true } });
      if (!kw) throw new ApiError(400, "validation_error", "Palabra clave no encontrada");
      data.keywordId = kw.id;
    }
  }

  // FAQ editada: se reescribe la sección visible del cuerpo (el schema FAQPage sale de ella).
  if (Array.isArray(b.faq)) {
    const base = typeof data.content === "string" ? data.content : cur.content ?? "";
    if (base) data.content = replaceFaqSection(base, b.faq, cur.site.language);
  }
  // Alt / título / leyenda de las imágenes (también en el brief, que usa la auditoría SEO).
  if (Array.isArray(b.imageMeta) && b.imageMeta.length) {
    const imgs = asArray<any>(cur.images).map((x) => ({ ...x }));
    const brief: any = cur.brief && typeof cur.brief === "object" ? { ...(cur.brief as any) } : null;
    const bImgs = brief ? asArray<any>(brief.images).map((x) => ({ ...x })) : [];
    for (const m of b.imageMeta) {
      for (const list of [imgs, bImgs]) {
        if (!list[m.index]) continue;
        if (typeof m.alt === "string") list[m.index].alt = m.alt.trim();
        if (typeof m.title === "string") list[m.index].title = m.title.trim();
        if (typeof m.caption === "string") list[m.index].caption = m.caption.trim();
      }
    }
    data.images = imgs as any;
    if (brief) data.brief = { ...brief, images: bImgs } as any;
  }

  const merged = { ...cur, ...data };
  if (["content", "metaTitle", "metaDescription", "keyword", "title", "slug", "brief"].some((k) => k in data) && merged.content) {
    const a = analyze(merged as any, cur.site);
    data.seoScore = a.score;
    data.seoReport = a as any;
    data.faq = extractFaq(merged.content ?? "") as any;
  }
  // Si ya estaba programado en la web → se reenvía con los cambios
  if (cur.status === "programada" && Object.keys(data).length) data.status = "aprobada";
  await prisma.seoBlogPost.updateMany({ where: { id: cur.id, workspaceId: api.workspaceId }, data });
  return NextResponse.json(await full(api.workspaceId, site.id, cur.id));
});

export const DELETE = withApi({ module: "seo", rate: "destructive" }, async (_req, { params, api }) => {
  const site = await ensureSeoSite(api.workspaceId);
  const id = String(params.id ?? "");
  const r = await prisma.seoBlogPost.deleteMany({ where: { id, workspaceId: api.workspaceId, siteId: site.id } });
  if (r.count) void cleanupSeoPostFiles(api.workspaceId, id);
  return NextResponse.json({ ok: true });
});
