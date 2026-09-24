/**
 * Máquina de estados de cada post del Publicador SEO.
 *
 * propuesta → planificada (fecha elegida) → en_cola → generando[research→brief→draft→humanize→seo(→seo_fix)*→images_request→images_wait→assemble]
 *   → revision (si el cliente requiere revisión) → aprobada → [push] → programada (post "future" en el WP del cliente) → publicada
 * Cualquier fallo → error (conserva el paso para reintentar).
 *
 * Cada llamada a stepPost() ejecuta UN paso (evita timeouts; la UI y el cron
 * lo llaman en bucle). Un lock atómico por post (lockedUntil) evita dobles ejecuciones.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { SeoBlogPost } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { complete, completeJson } from "@/lib/ai/anthropic";
import { downloadBuffer, signedDownloadUrl } from "@/lib/storage/r2";
import { getSeoBlogSettings, type SeoBlogSettings } from "./settings";
import { competitorOutlines, isAuthority, serperSearch } from "./serp";
import { BRIEF_SCHEMA, briefPrompt, draftPrompt, humanizePrompt, imagePrompt, seoFixPrompt, type SiteCtx } from "./prompts";
import { addToc, analyze, buildSchema, cleanHtml, extractFaq, norm } from "./seo";
import { getSiteCtx, referenceUrls, seoLog, sitePages, storeGeneratedImage } from "./service";
import { createSeedreamTask, checkSeedreamTask, isNanoBanana } from "./freepik";
import { WpError, wpEnsureTerm, wpGetPost, wpUploadMedia, wpUpsertPost } from "./wp";
import { asArray, asObject, hostOf, slugify, untrailingslash, wordCount } from "./util";

export const STEPS = ["research", "brief", "draft", "humanize", "seo", "seo_fix", "images_request", "images_wait", "assemble"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<string, string> = {
  research: "Investigando SERP y competencia",
  brief: "Creando brief SEO",
  draft: "Redactando",
  humanize: "Edición humanizada",
  seo: "Auditoría SEO",
  seo_fix: "Corrigiendo SEO",
  images_request: "Encargando imágenes",
  images_wait: "Generando imágenes",
  assemble: "Montando post",
  push: "Enviando a la web",
  "": ""
};

export type ImgItem = {
  role: "featured" | "inline";
  after_h2: number;
  subject: string;
  alt: string;
  title: string;
  caption: string;
  prompt?: string;
  aspect?: string;
  status?: "pending" | "done" | "failed";
  tries?: number;
  requestedAt?: number;
  taskId?: string;
  endpoint?: string;
  s3Key?: string;
  width?: number;
  height?: number;
  remoteId?: number;
  remoteUrl?: string;
  remoteFull?: string;
  error?: string;
};

type StepResult = { step?: string; status?: string; wait?: boolean; pending?: number; busy?: boolean; noop?: boolean; error?: string; remoteUrl?: string };

const LOCK_MS = 9 * 60 * 1000;

async function update(p: { id: string; workspaceId: string }, data: Record<string, any>) {
  await prisma.seoBlogPost.updateMany({ where: { id: p.id, workspaceId: p.workspaceId }, data });
}

async function next(p: SeoBlogPost, step: string, extra: Record<string, any> = {}): Promise<StepResult> {
  await update(p, { step, error: null, ...extra });
  const st = extra.status as string | undefined;
  await seoLog(
    p.workspaceId,
    { siteId: p.siteId, postId: p.id },
    step === "" ? (st === "revision" ? "✓ Redacción completa: pendiente de revisión" : "✓ Redacción completa: aprobada automáticamente") : `→ ${STEP_LABELS[step] ?? step}`
  );
  return { step, status: st };
}

/* ================================================================== */
/*  Ejecutar un paso                                                   */
/* ================================================================== */

export async function stepPost(workspaceId: string, postId: string): Promise<StepResult> {
  const now = new Date();
  const lock = await prisma.seoBlogPost.updateMany({
    where: { id: postId, workspaceId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) }
  });
  let p = await prisma.seoBlogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!p) return { error: "not_found" };
  if (lock.count !== 1) return { busy: true, step: p.step, status: p.status };

  let unlockAt: Date | null = null;
  try {
    const site = await getSiteCtx(workspaceId, p.siteId);
    if (!site) throw new Error("Cliente no encontrado");
    const settings = await getSeoBlogSettings(workspaceId);
    let res: StepResult;
    if (p.status === "aprobada") {
      res = await push(p, site, settings);
    } else if (p.status === "en_cola" || p.status === "generando") {
      if (p.status === "en_cola") {
        await update(p, { status: "generando", step: p.step || "research" });
        p = (await prisma.seoBlogPost.findFirst({ where: { id: postId, workspaceId } }))!;
      }
      const step = (p.step || "research") as Step;
      const fn = STEP_FNS[step];
      if (!fn) throw new Error(`Paso desconocido: ${step}`);
      res = await fn(p, site, settings);
    } else {
      return { status: p.status, step: p.step, noop: true };
    }
    if (res.wait) unlockAt = new Date(Date.now() + 20_000);
    const p2 = await prisma.seoBlogPost.findFirst({ where: { id: postId, workspaceId }, select: { status: true, step: true } });
    return { ...res, status: p2?.status, step: p2?.step };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await update(p, { status: "error", error: msg.slice(0, 2000), attempts: p.attempts + 1 });
    await seoLog(workspaceId, { siteId: p.siteId, postId: p.id }, `ERROR en ${p.step || p.status}: ${msg}`, "error");
    return { status: "error", step: p.step, error: msg };
  } finally {
    await prisma.seoBlogPost.updateMany({ where: { id: postId, workspaceId }, data: { lockedUntil: unlockAt } });
  }
}

/* ---------------- 1. Investigación ---------------- */

async function stepResearch(p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings): Promise<StepResult> {
  const serp = await serperSearch(s.serperApiKey, p.keyword, s.serperGl, s.serperHl);
  const host = hostOf(site.siteUrl);
  const competitors = serp ? await competitorOutlines(serp.organic, host, 3) : [];

  let internal: any[] = [];
  try {
    const pages = await sitePages(site);
    const tokens = [...new Set([...norm(p.keyword).split(" "), ...norm(p.title).split(" ")])].filter((t) => t.length > 3);
    internal = pages
      .map((x) => {
        const n = norm(`${x.title} ${x.excerpt ?? ""}`);
        const score = tokens.filter((t) => n.includes(t)).length + (x.type === "page" ? 1 : 0);
        return { ...x, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 60);
  } catch (e: any) {
    await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, `Enlazado interno sin datos de la web: ${e?.message ?? e}`, "warn");
  }

  const comps = String(site.competitors ?? "").split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
  let external = (serp?.organic ?? []).filter((o) => isAuthority(o.link, host, comps));
  if (external.length < 2 && s.serperApiKey) {
    const extra = await serperSearch(
      s.serperApiKey,
      `${p.keyword} (site:.gob.es OR site:.org OR site:.edu OR site:wikipedia.org OR site:europa.eu)`,
      s.serperGl,
      s.serperHl
    );
    for (const o of extra?.organic ?? []) if (isAuthority(o.link, host, comps)) external.push(o);
  }
  external = external.slice(0, 6);

  return next(p, "brief", { research: { serp, competitors, internalCandidates: internal, externalCandidates: external } });
}

/* ---------------- 2. Brief ---------------- */

async function stepBrief(p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings): Promise<StepResult> {
  const research = asObject<any>(p.research);
  const { system, user } = briefPrompt(site, p, research);
  const b = await completeJson<any>({
    workspaceId: p.workspaceId,
    feature: "seo_blog_brief",
    model: s.modelFast,
    maxTokens: 8000,
    schema: BRIEF_SCHEMA,
    system,
    user
  });

  // Solo URLs proporcionadas: cero enlaces inventados
  const allowedInt = new Set(asArray<any>(research.internalCandidates).map((x) => untrailingslash(x.url)));
  const allowedExt = new Set(asArray<any>(research.externalCandidates).map((x) => untrailingslash(x.link)));
  b.internal_links = asArray<any>(b.internal_links).filter((l) => allowedInt.has(untrailingslash(l?.url ?? "")));
  b.external_links = asArray<any>(b.external_links).filter((l) => allowedExt.has(untrailingslash(l?.url ?? "")));
  if (site.ctaUrl && !b.internal_links.some((l: any) => untrailingslash(l.url) === untrailingslash(site.ctaUrl))) {
    b.internal_links.push({ url: site.ctaUrl, anchor: site.ctaText || "contacta con nosotros", section: "cierre" });
  }

  // Imágenes: nº exacto, la primera es la portada
  const want = Math.max(1, site.imagesPerPost);
  const imgs: ImgItem[] = asArray<any>(b.images).slice(0, want);
  while (imgs.length < want) {
    imgs.push({ role: "inline", after_h2: imgs.length + 1, subject: `Authentic scene related to ${p.keyword}`, alt: p.keyword, title: p.keyword, caption: "" });
  }
  b.images = imgs.map((im, i) => ({ ...im, role: i === 0 ? "featured" : "inline" }));

  const secondary = [...new Set([...asArray<string>(p.secondaryKeywords), ...asArray<string>(b.secondary_keywords)])];
  return next(p, "draft", {
    brief: b,
    title: String(b.h1 || p.title).slice(0, 250),
    metaTitle: String(b.meta_title ?? "").slice(0, 200),
    metaDescription: String(b.meta_description ?? "").slice(0, 400),
    slug: slugify(b.slug || p.keyword),
    category: site.defaultCategory || String(b.category ?? ""),
    tags: asArray<string>(b.tags).slice(0, 6),
    secondaryKeywords: secondary
  });
}

/* ---------------- 3. Redacción ---------------- */

async function stepDraft(p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings): Promise<StepResult> {
  const { system, user } = draftPrompt(site, p, p.brief);
  const html = cleanHtml(
    await complete({ workspaceId: p.workspaceId, feature: "seo_blog_draft", model: s.modelWriter, maxTokens: 16000, system, user })
  );
  if (wordCount(html) < 300) throw new Error("La redacción ha salido demasiado corta.");
  return next(p, "humanize", { content: html });
}

/* ---------------- 4. Humanización ---------------- */

async function stepHumanize(p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings): Promise<StepResult> {
  const before = String(p.content ?? "");
  const { system, user } = humanizePrompt(site, p, before);
  let html = cleanHtml(
    await complete({ workspaceId: p.workspaceId, feature: "seo_blog_humanize", model: s.modelWriter, maxTokens: 16000, system, user })
  );
  const wb = wordCount(before);
  const wa = wordCount(html);
  if (wa < wb * 0.75) {
    await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, `Edición descartada: recortó demasiado (${wb} → ${wa} palabras). Se mantiene el borrador.`, "warn");
    html = before;
  } else {
    const lost = [...new Set([...before.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]))].filter((u) => !html.includes(u));
    if (lost.length) await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, `Enlaces perdidos en la edición (se recuperan en la corrección SEO): ${lost.join(", ")}`, "warn");
  }
  return next(p, "seo", { content: html });
}

/* ---------------- 5. Auditoría SEO (+ corrección) ---------------- */

async function stepSeo(p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings): Promise<StepResult> {
  const a = analyze(p, site);
  await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, `Puntuación SEO: ${a.score}/100`);
  const brief = asObject<any>(p.brief);
  const missingLinks = [...asArray<any>(brief.internal_links), ...asArray<any>(brief.external_links)].some(
    (l) => l?.url && !String(p.content ?? "").includes(l.url)
  );
  if ((a.score < s.seoMinScore || missingLinks) && p.fixPasses < s.maxFixPasses && (a.issues.length || missingLinks)) {
    return next(p, "seo_fix", { seoScore: a.score, seoReport: a as any });
  }
  return next(p, "images_request", { seoScore: a.score, seoReport: a as any });
}

async function stepSeoFix(p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings): Promise<StepResult> {
  const report = asObject<any>(p.seoReport);
  const issues = asArray<string>(report.issues).slice();
  const brief = asObject<any>(p.brief);
  for (const l of [...asArray<any>(brief.internal_links), ...asArray<any>(brief.external_links)]) {
    if (l?.url && !String(p.content ?? "").includes(l.url)) issues.push(`Falta el enlace <a href="${l.url}">${l.anchor}</a>: intégralo en contexto.`);
  }
  const upd: Record<string, any> = { fixPasses: p.fixPasses + 1 };
  try {
    const { system, user } = seoFixPrompt(site, p, String(p.content ?? ""), issues);
    const out = await complete({ workspaceId: p.workspaceId, feature: "seo_blog_fix", model: s.modelWriter, maxTokens: 16000, system, user });
    const mt = /<!--\s*META_TITLE:\s*([\s\S]*?)\s*-->/i.exec(out);
    const md = /<!--\s*META_DESCRIPTION:\s*([\s\S]*?)\s*-->/i.exec(out);
    if (mt) upd.metaTitle = mt[1].trim().slice(0, 200);
    if (md) upd.metaDescription = md[1].trim().slice(0, 400);
    const html = cleanHtml(out.replace(/<!--\s*META_(TITLE|DESCRIPTION):[\s\S]*?-->/gi, ""));
    if (wordCount(html) >= wordCount(p.content ?? "") * 0.8) upd.content = html;
  } catch (e: any) {
    await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, `Corrección SEO fallida: ${e?.message ?? e}`, "warn");
  }
  return next(p, "seo", upd);
}

/* ---------------- 6. Imágenes ---------------- */

async function stepImagesRequest(p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings): Promise<StepResult> {
  const imgs = asArray<ImgItem>(asObject<any>(p.brief).images);
  if (!imgs.length) return next(p, "assemble", { images: [] });
  const refs = await referenceUrls(p.workspaceId, site.id, 5);
  const out: ImgItem[] = [];
  let anyOk = false;
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    const prompt = imagePrompt(site, img, refs.length > 0, isNanoBanana(s));
    const row: ImgItem = { ...img, prompt, aspect: site.imageAspect || "widescreen_16_9", status: "pending", tries: 1, requestedAt: Date.now() };
    try {
      const t = await createSeedreamTask(p.workspaceId, s, prompt, row.aspect!, refs);
      row.taskId = t.taskId;
      row.endpoint = t.endpoint;
      anyOk = true;
    } catch (e: any) {
      row.status = "failed";
      row.error = e?.message ?? String(e);
      await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, `Imagen ${i}: ${row.error}`, "warn");
    }
    out.push(row);
  }
  if (!anyOk) {
    await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, "No se pudo encargar ninguna imagen (revisa la API key de Freepik). El post continúa sin imágenes.", "warn");
    return next(p, "assemble", { images: out as any });
  }
  return next(p, "images_wait", { images: out as any });
}

/** Consulta las imágenes pendientes y descarga las terminadas a R2. Devuelve cuántas siguen pendientes. */
export async function pollImages(p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings): Promise<number> {
  const imgs = asArray<ImgItem>(p.images).map((x) => ({ ...x }));
  let pending = 0;
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (img.status !== "pending" || !img.taskId || !img.endpoint) continue;
    let r: { status: string; urls: string[] };
    try {
      r = await checkSeedreamTask(p.workspaceId, s, img.endpoint, img.taskId);
    } catch {
      pending++;
      continue;
    }
    if (r.status === "COMPLETED" && r.urls.length) {
      try {
        const stored = await storeGeneratedImage(p.workspaceId, p.id, r.urls[0], `${p.slug || slugify(p.keyword)}-${i === 0 ? "portada" : i}`);
        Object.assign(img, stored, { status: "done", remoteId: 0, remoteUrl: "", remoteFull: "", error: "" });
      } catch (e: any) {
        img.status = "failed";
        img.error = e?.message ?? String(e);
      }
    } else if (r.status === "FAILED") {
      const tries = img.tries ?? 1;
      if (tries < 3) {
        // 2.º intento: prompt simplificado (Seedream rechaza a veces prompts largos o con negaciones).
        // 3.º intento: escena neutra del sector (el filtro de seguridad rechaza escenas médicas/corporales explícitas).
        const safe = `Editorial photograph for a blog article of a ${site.sector || "business"}${site.location ? " in " + site.location : ""}: bright, elegant premises interior or a professional at work seen from a distance, natural light, clean composition, no close-ups of bodies, no medical devices, no text.`;
        const promptTry = tries === 1
          ? `Scene: ${img.subject}. Photorealistic editorial image, natural light.${site.visualStyle ? " Style: " + site.visualStyle.slice(0, 400) : ""}`
          : safe + (site.visualStyle ? " Style: " + site.visualStyle.slice(0, 300) : "");
        img.tries = tries + 1;
        if (tries === 2) await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, `Imagen ${i}: Seedream rechazó la escena dos veces (filtro de seguridad); se genera una escena neutra del sector.`, "warn");
        try {
          const t = await createSeedreamTask(p.workspaceId, s, promptTry, img.aspect ?? "widescreen_16_9", await referenceUrls(p.workspaceId, site.id, 5));
          Object.assign(img, { taskId: t.taskId, endpoint: t.endpoint, requestedAt: Date.now() });
          pending++;
        } catch (e: any) {
          img.status = "failed";
          img.error = e?.message ?? String(e);
        }
      } else {
        img.status = "failed";
        img.error = "Seedream rechazó la escena (filtro de seguridad). Cambia la escena en esta pestaña y pulsa «Regenerar».";
      }
    } else if (Date.now() - (img.requestedAt ?? 0) > 20 * 60 * 1000) {
      img.status = "failed";
      img.error = "Timeout de generación (20 min)";
    } else {
      pending++;
    }
  }
  await update(p, { images: imgs as any });
  return pending;
}

async function stepImagesWait(p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings): Promise<StepResult> {
  const pending = await pollImages(p, site, s);
  if (pending > 0) return { step: "images_wait", wait: true, pending };
  return next(p, "assemble");
}

export async function regenImage(p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings, index: number, subject?: string) {
  const imgs = asArray<ImgItem>(p.images).map((x) => ({ ...x }));
  const briefImgs = asArray<ImgItem>(asObject<any>(p.brief).images);
  if (!imgs[index]) {
    if (!briefImgs[index]) throw new Error("Imagen no encontrada");
    imgs[index] = { ...briefImgs[index] };
  }
  if (subject) imgs[index].subject = subject;
  const refs = await referenceUrls(p.workspaceId, site.id, 5);
  const prompt = imagePrompt(site, imgs[index], refs.length > 0, isNanoBanana(s));
  const aspect = imgs[index].aspect ?? (site.imageAspect || "widescreen_16_9");
  const t = await createSeedreamTask(p.workspaceId, s, prompt, aspect, refs);
  imgs[index] = {
    ...imgs[index], prompt, aspect, status: "pending", tries: 1, requestedAt: Date.now(),
    taskId: t.taskId, endpoint: t.endpoint, remoteId: 0, remoteUrl: "", remoteFull: "", error: ""
  };
  for (let i = 0; i < imgs.length; i++) if (!imgs[i]) imgs[i] = { ...briefImgs[i], status: "failed", error: "sin generar" };
  await update(p, { images: imgs as any });
  await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, `Regenerando imagen ${index}`);
}

/* ---------------- 7. Montaje ---------------- */

const escAttr = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Inserta figuras + índice. `srcFor(i)` resuelve la URL de cada imagen (R2 firmada o remota). */
export function assembleHtml(content: string, imgs: ImgItem[], lang: string, srcFor: (img: ImgItem, i: number) => string | null, remote = false): string {
  let html = String(content ?? "");
  imgs.forEach((img, i) => {
    if (i === 0) return;
    const marker = `<!--NVP_IMG_${i}-->`;
    const src = img.status === "done" ? srcFor(img, i) : null;
    if (!src) {
      html = html.split(marker).join("");
      return;
    }
    const cls = remote && img.remoteId ? ` class="wp-image-${img.remoteId}"` : "";
    const dims = img.width && img.height ? ` width="${img.width}" height="${img.height}"` : "";
    const fig =
      `<figure class="wp-block-image size-large nvp-figure"><img src="${escAttr(src)}" alt="${escAttr(img.alt)}" title="${escAttr(img.title)}"${dims}${cls} loading="lazy" decoding="async" />` +
      (img.caption ? `<figcaption>${escAttr(img.caption)}</figcaption>` : "") +
      "</figure>";
    if (html.includes(marker)) {
      html = html.split(marker).join(fig);
    } else {
      // Marcador perdido en la edición: insertar tras el primer párrafo del H2 indicado
      const target = Number(img.after_h2 ?? i);
      let n = -1;
      html = html.replace(/(<h2[^>]*>[\s\S]*?<\/h2>\s*<p[^>]*>[\s\S]*?<\/p>)/gi, (m) => (++n === target ? `${m}\n${fig}` : m));
    }
  });
  html = html.replace(/<!--NVP_IMG_\d+-->/g, "");
  return addToc(html, lang);
}

async function stepAssemble(p: SeoBlogPost, site: SiteCtx): Promise<StepResult> {
  const a = analyze(p, site);
  const status = site.autoPublish ? "aprobada" : "revision";
  await update(p, {
    faq: extractFaq(p.content ?? "") as any,
    seoScore: a.score,
    seoReport: a as any,
    excerpt: p.metaDescription,
    generatedAt: new Date()
  });
  const res = await next(p, "", { status });
  if (status === "revision") await notifyReview(p, site, a.score);
  return res;
}

async function notifyReview(p: SeoBlogPost, site: SiteCtx, score: number) {
  try {
    // Avisar a quien creó la propuesta y a los admins del workspace (campana del Hub).
    const admins = await prisma.membership.findMany({ where: { workspaceId: p.workspaceId, role: "ADMIN" }, select: { userId: true } });
    const ids = new Set<string>(admins.map((m) => m.userId));
    if (p.createdById) ids.add(p.createdById);
    await prisma.notification.createMany({
      data: [...ids].map((userId) => ({
        userId,
        type: "SEO_BLOG_REVIEW",
        body: `Post listo para revisar · ${site.client.name}: «${p.title}» (SEO ${score}/100)`,
        link: `/publicador-seo?post=${p.id}`
      }))
    });
  } catch {
    /* las notificaciones nunca bloquean el pipeline */
  }
}

/* ================================================================== */
/*  Envío a la web del cliente                                         */
/* ================================================================== */

async function toWebp(s3Key: string) {
  const buf = await downloadBuffer(s3Key);
  const out = await sharp(buf, { failOn: "none" }).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  return { bytes: out.data, width: out.info.width, height: out.info.height };
}

export async function push(p: SeoBlogPost, site: SiteCtx, _s?: SeoBlogSettings): Promise<StepResult> {
  if (!site.siteUrl || !site.wpUser || !site.wpAppPasswordEnc) {
    throw new Error("El cliente no tiene configurada la conexión WordPress (URL, usuario y Application Password).");
  }
  await update(p, { step: "push" });
  const imgs = asArray<ImgItem>(p.images).map((x) => ({ ...x }));
  const slug = p.slug || slugify(p.keyword);

  // 1) Imágenes (idempotente: las ya subidas no se repiten)
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (img.status !== "done" || !img.s3Key || img.remoteId) continue;
    const up = await toWebp(img.s3Key);
    const m = await wpUploadMedia(site, up.bytes, `${slugify(`${slug}-${i === 0 ? "portada" : i}`)}.webp`, "image/webp", {
      alt: img.alt, title: img.title, caption: img.caption
    });
    Object.assign(img, { remoteId: m.id, remoteUrl: m.largeUrl || m.url, remoteFull: m.url, width: m.width ?? up.width, height: m.height ?? up.height });
    await update(p, { images: imgs as any });
  }

  // 2) Contenido + schema
  const html = assembleHtml(p.content ?? "", imgs, site.language, (img) => img.remoteUrl || null, true);
  const faq = asArray<{ q: string; a: string }>(p.faq);
  const schema = buildSchema(p, { siteUrl: site.siteUrl, language: site.language, location: site.location, clientName: site.client.name }, imgs[0]?.remoteFull ?? "", faq);

  // 3) Taxonomías
  const categories: number[] = [];
  if (p.category) {
    const id = await wpEnsureTerm(site, "category", p.category);
    if (id) categories.push(id);
  }
  const tags: number[] = [];
  for (const t of asArray<string>(p.tags).slice(0, 6)) {
    const id = await wpEnsureTerm(site, "post_tag", t);
    if (id) tags.push(id);
  }

  // 4) Fecha/estado: programado ("future") y lo publica el propio WordPress
  const when = p.publishAt ?? new Date();
  const future = when.getTime() > Date.now() + 120_000;
  const payload: Record<string, any> = {
    title: p.title,
    content: html,
    excerpt: p.excerpt || p.metaDescription,
    slug,
    status: future ? "future" : "publish",
    meta: {
      nvseo_title: p.metaTitle,
      nvseo_description: p.metaDescription,
      nvseo_focus_kw: p.keyword,
      nvseo_schema: JSON.stringify(schema)
    }
  };
  if (future) payload.date_gmt = when.toISOString().slice(0, 19);
  if (imgs[0]?.remoteId) payload.featured_media = imgs[0].remoteId;
  if (categories.length) payload.categories = categories;
  if (tags.length) payload.tags = tags;
  if (site.wpAuthorId > 0) payload.author = site.wpAuthorId;

  let r: any;
  try {
    r = await wpUpsertPost(site, payload, p.remoteId);
  } catch (e) {
    if (e instanceof WpError && /meta/i.test(e.message)) {
      delete payload.meta; // web sin plugin puente
      r = await wpUpsertPost(site, payload, p.remoteId);
    } else throw e;
  }

  const bridge = r?.meta && typeof r.meta === "object" && "nvseo_schema" in r.meta;
  if (!bridge) {
    const json = JSON.stringify(schema)
      .split("%%permalink%%").join(String(r.link ?? ""))
      .split("%%date_published%%").join(String(r.date ?? ""))
      .split("%%date_modified%%").join(String(r.modified ?? r.date ?? ""));
    await wpUpsertPost(site, { content: `${html}\n<script type="application/ld+json">${json}</script>` }, Number(r.id)).catch(() => null);
    await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, "Web sin plugin NV SEO Bridge: meta title/description no aplicados en Yoast/Rank Math; schema embebido en el contenido.", "warn");
  }
  if (bridge !== site.bridgeDetected) {
    await prisma.seoBlogSite.updateMany({ where: { id: site.id, workspaceId: site.workspaceId }, data: { bridgeDetected: !!bridge } });
  }

  const status = r?.status === "publish" ? "publicada" : "programada";
  await update(p, { remoteId: Number(r.id), remoteUrl: String(r.link ?? ""), status, step: "", schemaJson: schema as any, error: null });
  await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, `${status === "publicada" ? "Publicado" : "Programado en la web del cliente"}: ${r.link ?? ""}`);
  return { status, remoteUrl: String(r.link ?? "") };
}

/** Comprueba en la web si un post programado ya se publicó (y lo fuerza si su WP-Cron falló). */
export async function checkRemote(p: SeoBlogPost) {
  if (!p.remoteId) return;
  const site = await getSiteCtx(p.workspaceId, p.siteId);
  if (!site) return;
  const r = await wpGetPost(site, p.remoteId).catch(() => null);
  if (!r) return;
  if (r.status === "publish") {
    await update(p, { status: "publicada", remoteUrl: String(r.link ?? p.remoteUrl) });
    await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, `Publicado: ${r.link}`);
  } else if (r.status === "future" && p.publishAt && p.publishAt.getTime() < Date.now() - 30 * 60 * 1000) {
    await wpUpsertPost(site, { status: "publish", date_gmt: p.publishAt.toISOString().slice(0, 19) }, p.remoteId).catch(() => null);
    await seoLog(p.workspaceId, { siteId: p.siteId, postId: p.id }, "Publicación forzada (el WP-Cron de la web del cliente no la ejecutó a tiempo)", "warn");
  }
}

const STEP_FNS: Record<Step, (p: SeoBlogPost, site: SiteCtx, s: SeoBlogSettings) => Promise<StepResult>> = {
  research: stepResearch,
  brief: stepBrief,
  draft: stepDraft,
  humanize: stepHumanize,
  seo: stepSeo,
  seo_fix: stepSeoFix,
  images_request: stepImagesRequest,
  images_wait: stepImagesWait,
  assemble: (p, site) => stepAssemble(p, site)
};

/* ================================================================== */
/*  Tick global (planificador interno / endpoint cron)                 */
/* ================================================================== */

export async function runSeoBlogTick(budgetMs = 170_000): Promise<{ processed: number; published: number }> {
  const start = Date.now();
  let processed = 0;
  let published = 0;

  // 1) Planificadas cuya ventana de redacción (N días antes) ha llegado → cola
  const planned = await prisma.seoBlogPost.findMany({
    where: { status: "planificada", publishAt: { not: null }, site: { active: true } },
    select: { id: true, workspaceId: true, publishAt: true, site: { select: { leadDays: true } } },
    take: 500
  });
  for (const r of planned) {
    const genAt = r.publishAt!.getTime() - Math.max(0, r.site.leadDays) * 86400 * 1000;
    if (genAt <= Date.now()) await update(r, { status: "en_cola", step: "research", error: null });
  }

  // 2) Avanzar generación / envíos mientras quede presupuesto
  const tried = new Set<string>();
  for (let iter = 0; iter < 60 && Date.now() - start < budgetMs; iter++) {
    const now = new Date();
    let cand = await prisma.seoBlogPost.findFirst({
      where: {
        status: { in: ["aprobada", "generando", "en_cola"] },
        id: { notIn: [...tried] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }]
      },
      orderBy: [{ publishAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, workspaceId: true }
    });
    if (!cand) {
      // Reintento automático de errores (máx 3) tras 15 min
      const err = await prisma.seoBlogPost.findFirst({
        where: { status: "error", attempts: { lt: 3 }, updatedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) }, id: { notIn: [...tried] } },
        select: { id: true, workspaceId: true, step: true }
      });
      if (!err) break;
      await update(err, { status: err.step === "push" ? "aprobada" : "generando" });
      cand = err;
    }
    const r = await stepPost(cand.workspaceId, cand.id);
    processed++;
    if (r.wait || r.busy || r.noop || r.status === "error") tried.add(cand.id);
  }

  // 3) Programadas cuya fecha ya pasó → comprobar publicación
  const due = await prisma.seoBlogPost.findMany({ where: { status: "programada", publishAt: { lt: new Date() } }, take: 20 });
  for (const p of due) {
    await checkRemote(p);
    published++;
  }
  return { processed, published };
}

export const seoBlogLeaseOwner = randomUUID();

/** Resuelve URLs firmadas de R2 para la vista previa. */
export async function previewHtml(p: SeoBlogPost, lang: string) {
  const imgs = asArray<ImgItem>(p.images);
  const urls = await Promise.all(imgs.map((im) => (im.status === "done" && im.s3Key ? signedDownloadUrl(im.s3Key, 3600).catch(() => null) : Promise.resolve(null))));
  const raw = p.content ? assembleHtml(p.content, imgs, lang, (_im, i) => urls[i]) : "";
  // Vista previa dentro del Hub: sin scripts, iframes ni manejadores inline
  const html = raw
    .replace(/<(script|iframe|object|embed|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  return { html, imageUrls: urls };
}
