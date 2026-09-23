/**
 * Servicios del Publicador SEO: acceso a datos, referencias de estilo, SERP por
 * keyword, propuestas IA, sugerencia de keywords y análisis de estilo visual.
 */
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { buildS3Key, isStorageEnabled, signedDownloadUrl, uploadBuffer, deleteObject } from "@/lib/storage/r2";
import { getSeoBlogSettings } from "./settings";
import { serperSearch, type Serp } from "./serp";
import { wpSitePages, type SitePage } from "./wp";
import { IDEAS_SCHEMA, KEYWORDS_SCHEMA, STYLE_SCHEMA, STYLE_SYSTEM, STYLE_USER, ideasPrompt, keywordSuggestPrompt, type SiteCtx } from "./prompts";
import { asArray } from "./util";

export const CLIENT_SELECT = { name: true, brandBrief: true, infoGeneral: true, website: true } as const;

export async function seoLog(
  workspaceId: string,
  ref: { siteId?: string | null; postId?: string | null },
  message: string,
  level: "info" | "warn" | "error" = "info"
) {
  await prisma.seoBlogLog
    .create({ data: { workspaceId, siteId: ref.siteId ?? null, postId: ref.postId ?? null, level, message: message.slice(0, 4000) } })
    .catch(() => null);
}

export async function getSiteCtx(workspaceId: string, siteId: string): Promise<SiteCtx | null> {
  return (await prisma.seoBlogSite.findFirst({
    where: { id: siteId, workspaceId },
    include: { client: { select: CLIENT_SELECT } }
  })) as SiteCtx | null;
}

/* ------------------------------------------------------------------ */
/*  Imágenes: referencias y generadas                                  */
/* ------------------------------------------------------------------ */

/**
 * Regla NV: toda imagen que pueda ir a Anthropic se redimensiona a máx. 1800 px
 * y JPEG q82. Las referencias se guardan ya así en R2.
 */
export async function storeReference(workspaceId: string, siteId: string, input: Buffer, filename: string, label = "") {
  if (!isStorageEnabled()) throw new Error("El almacenamiento (R2) no está configurado en el Hub.");
  const img = sharp(input, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height || meta.width < 256 || meta.height < 256) {
    throw new Error("La imagen debe medir al menos 256×256 px.");
  }
  const out = await img
    .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const s3Key = buildS3Key({ workspaceId, targetType: "SEOBLOG_REF", targetId: siteId, filename: filename.replace(/\.\w+$/, "") + ".jpg" });
  await uploadBuffer({ s3Key, body: out.data, contentType: "image/jpeg" });
  return prisma.seoBlogRef.create({
    data: { workspaceId, siteId, s3Key, width: out.info.width, height: out.info.height, label }
  });
}

export async function deleteReference(workspaceId: string, refId: string) {
  const ref = await prisma.seoBlogRef.findFirst({ where: { id: refId, workspaceId } });
  if (!ref) return false;
  await prisma.seoBlogRef.deleteMany({ where: { id: ref.id, workspaceId } });
  await deleteObject(ref.s3Key).catch(() => null);
  return true;
}

/** URLs públicas firmadas (1h) de las referencias, para Freepik y la UI. */
export async function referenceUrls(workspaceId: string, siteId: string, limit = 5): Promise<string[]> {
  if (!isStorageEnabled()) return [];
  const refs = await prisma.seoBlogRef.findMany({ where: { workspaceId, siteId }, orderBy: { createdAt: "asc" }, take: limit });
  return Promise.all(refs.map((r) => signedDownloadUrl(r.s3Key, 3600)));
}

/** Guarda una imagen generada en R2 como WebP ≤1600 px (maestro para vista previa y envío). */
export async function storeGeneratedImage(workspaceId: string, postId: string, url: string, baseName: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`No se pudo descargar la imagen generada (${r.status})`);
  const input = Buffer.from(await r.arrayBuffer());
  const out = await sharp(input, { failOn: "none" })
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const s3Key = buildS3Key({ workspaceId, targetType: "SEOBLOG_POST", targetId: postId, filename: `${baseName}.webp` });
  await uploadBuffer({ s3Key, body: out.data, contentType: "image/webp" });
  return { s3Key, width: out.info.width, height: out.info.height };
}

/* ------------------------------------------------------------------ */
/*  Web del cliente (enlazado interno) y SERP                          */
/* ------------------------------------------------------------------ */

export async function sitePages(site: SiteCtx, force = false): Promise<SitePage[]> {
  if (!force && site.siteCache && site.siteCacheAt && Date.now() - site.siteCacheAt.getTime() < 12 * 3600 * 1000) {
    return asArray<SitePage>(site.siteCache);
  }
  if (!site.siteUrl || !site.wpUser || !site.wpAppPasswordEnc) return asArray<SitePage>(site.siteCache);
  const pages = await wpSitePages(site);
  await prisma.seoBlogSite.updateMany({
    where: { id: site.id, workspaceId: site.workspaceId },
    data: { siteCache: pages as any, siteCacheAt: new Date() }
  });
  return pages;
}

export async function keywordSerp(workspaceId: string, kw: { id: string; keyword: string; serp: any; serpAt: Date | null }): Promise<Serp | null> {
  if (kw.serp && kw.serpAt && Date.now() - kw.serpAt.getTime() < 7 * 86400 * 1000) return kw.serp as Serp;
  const s = await getSeoBlogSettings(workspaceId);
  const serp = await serperSearch(s.serperApiKey, kw.keyword, s.serperGl, s.serperHl);
  if (serp) {
    await prisma.seoBlogKeyword.updateMany({ where: { id: kw.id, workspaceId }, data: { serp: serp as any, serpAt: new Date() } });
  }
  return serp;
}

/* ------------------------------------------------------------------ */
/*  Propuestas IA                                                      */
/* ------------------------------------------------------------------ */

export async function generateIdeas(
  workspaceId: string,
  siteId: string,
  opts: { n?: number; focus?: string; keywordIds?: string[]; userId?: string | null }
): Promise<number> {
  const site = await getSiteCtx(workspaceId, siteId);
  if (!site) throw new Error("Cliente no encontrado");
  const settings = await getSeoBlogSettings(workspaceId);
  const n = Math.max(3, Math.min(30, opts.n || settings.ideasPerRun));

  let kws = await prisma.seoBlogKeyword.findMany({ where: { workspaceId, siteId }, orderBy: [{ priority: "asc" }, { keyword: "asc" }] });
  if (opts.keywordIds?.length) kws = kws.filter((k) => opts.keywordIds!.includes(k.id));
  if (!kws.length) throw new Error("Añade al menos una palabra clave al cliente.");

  let block = "";
  for (const k of kws.slice(0, 25)) {
    const serp = await keywordSerp(workspaceId, k);
    block += `[keyword_id=${k.id}] «${k.keyword}» (tipo ${k.kwType}, prioridad ${k.priority}${k.intent ? `, intención ${k.intent}` : ""}${k.volume ? `, vol. ${k.volume}` : ""})\n`;
    if (k.notes) block += `   Notas: ${k.notes}\n`;
    if (serp) {
      block += `   Top Google: ${serp.organic.slice(0, 5).map((o) => o.title).join(" | ")}\n`;
      if (serp.paa.length) block += `   PAA: ${serp.paa.slice(0, 6).join(" | ")}\n`;
      if (serp.related.length) block += `   Relacionadas: ${serp.related.slice(0, 8).join(" | ")}\n`;
    }
  }

  let siteTitles = "";
  try {
    const pages = await sitePages(site);
    siteTitles = pages.filter((p) => p.type === "post").slice(0, 150).map((p) => `- ${p.title}`).join("\n");
  } catch (e: any) {
    await seoLog(workspaceId, { siteId }, `No se pudo leer la web del cliente: ${e?.message ?? e}`, "warn");
  }
  const planned = await prisma.seoBlogPost.findMany({
    where: { workspaceId, siteId, status: { not: "descartada" } },
    select: { title: true },
    orderBy: { createdAt: "desc" },
    take: 150
  });

  const { system, user } = ideasPrompt(site, block, siteTitles, planned.map((p) => `- ${p.title}`).join("\n"), n, opts.focus ?? "");
  const res = await completeJson<{ ideas: any[] }>({
    workspaceId,
    userId: opts.userId ?? null,
    feature: "seo_blog_ideas",
    model: settings.modelFast,
    maxTokens: 8000,
    schema: IDEAS_SCHEMA,
    system,
    user
  });

  const byId = new Map(kws.map((k) => [k.id, k]));
  const rows = asArray<any>(res?.ideas)
    .filter((i) => i?.title)
    .map((i) => {
      const k = byId.get(String(i.keyword_id));
      return {
        workspaceId,
        siteId,
        keywordId: k?.id ?? null,
        keyword: k?.keyword ?? String(i.keyword ?? ""),
        title: String(i.title).slice(0, 250),
        angle: i.format ? `[${i.format}] ${i.angle ?? ""}` : String(i.angle ?? ""),
        intent: String(i.intent ?? ""),
        funnel: String(i.funnel ?? ""),
        secondaryKeywords: asArray<string>(i.secondary_keywords).map(String),
        rationale: String(i.rationale ?? ""),
        status: "propuesta",
        createdById: opts.userId ?? null
      };
    });
  if (rows.length) await prisma.seoBlogPost.createMany({ data: rows as any });
  await seoLog(workspaceId, { siteId }, `${rows.length} propuestas generadas`);
  return rows.length;
}

export async function suggestKeywords(workspaceId: string, siteId: string, userId?: string | null) {
  const site = await getSiteCtx(workspaceId, siteId);
  if (!site) throw new Error("Cliente no encontrado");
  const settings = await getSeoBlogSettings(workspaceId);
  const existing = (await prisma.seoBlogKeyword.findMany({ where: { workspaceId, siteId }, select: { keyword: true } })).map((k) => k.keyword);
  let seed = "";
  for (const e of existing.slice(0, 5)) {
    const s = await serperSearch(settings.serperApiKey, e, settings.serperGl, settings.serperHl);
    if (s) seed += `«${e}» → relacionadas: ${s.related.join(" | ")} · PAA: ${s.paa.join(" | ")}\n`;
  }
  if (!existing.length && site.sector) {
    const s = await serperSearch(settings.serperApiKey, `${site.sector} ${site.location}`.trim(), settings.serperGl, settings.serperHl);
    if (s) seed += `Relacionadas: ${s.related.join(" | ")} · PAA: ${s.paa.join(" | ")}\n`;
  }
  const { system, user } = keywordSuggestPrompt(site, existing, seed);
  const res = await completeJson<{ keywords: any[] }>({
    workspaceId,
    userId: userId ?? null,
    feature: "seo_blog_keywords",
    model: settings.modelFast,
    maxTokens: 4000,
    schema: KEYWORDS_SCHEMA,
    system,
    user
  });
  const lower = new Set(existing.map((e) => e.toLowerCase()));
  return asArray<any>(res?.keywords).filter((k) => k?.keyword && !lower.has(String(k.keyword).toLowerCase()));
}

/** Claude Vision analiza las referencias y guarda la guía de estilo visual del cliente. */
export async function analyzeStyle(workspaceId: string, siteId: string, userId?: string | null) {
  const urls = await referenceUrls(workspaceId, siteId, 8);
  if (!urls.length) throw new Error("Sube primero imágenes de referencia.");
  const settings = await getSeoBlogSettings(workspaceId);
  const res = await completeJson<{ style_prompt: string; palette: string[]; mood: string; summary_es: string }>({
    workspaceId,
    userId: userId ?? null,
    feature: "seo_blog_style",
    model: settings.modelFast,
    maxTokens: 1500,
    schema: STYLE_SCHEMA,
    system: STYLE_SYSTEM,
    user: STYLE_USER,
    imageUrls: urls
  });
  await prisma.seoBlogSite.updateMany({ where: { id: siteId, workspaceId }, data: { visualStyle: String(res.style_prompt ?? "").trim() } });
  return res;
}
