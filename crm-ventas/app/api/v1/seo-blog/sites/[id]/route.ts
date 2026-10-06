import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError, requireAdminRole } from "@/lib/api/auth";
import { requireOwnSite, siteOut } from "@/lib/seo-blog/access";
import { encryptSecret } from "@/lib/ai/crypto";
import { normalizeSiteUrl } from "@/lib/seo-blog/wp";
import { deleteObject } from "@/lib/storage/r2";
import { bool, num, parseBody, z } from "@/lib/seo-blog/validate";

export const dynamic = "force-dynamic";

const TEXT = ["siteUrl", "wpUser", "language", "location", "sector", "tone", "ctaText", "ctaUrl", "defaultCategory", "publishTime", "imageAspect", "color"] as const;
const LONG = ["businessInfo", "audience", "brandVoice", "compliance", "forbidden", "competitors", "visualStyle", "visualNotes"] as const;
const INTS: Record<string, [number, number]> = { wpAuthorId: [0, 1e9], leadDays: [0, 30], wordsMin: [300, 6000], wordsMax: [400, 8000], imagesPerPost: [1, 6] };
const BOOLS = ["autoPublish"] as const;
/** Campos de la conexión con WordPress: solo los cambia un administrador del negocio. */
const CONNECTION = ["siteUrl", "wpUser", "wpAppPasswordEnc"] as const;

const LANGUAGES = ["es-ES", "es-MX", "es", "en-GB", "en-US", "de-DE", "fr-FR", "it-IT", "pt-PT", "ca-ES"];
const ASPECTS = ["widescreen_16_9", "standard_3_2", "classic_4_3", "square_1_1"];

const optText = z.union([z.string(), z.null()]).optional();
const Body = z.object({
  ...Object.fromEntries(TEXT.map((k) => [k, optText])),
  ...Object.fromEntries(LONG.map((k) => [k, optText])),
  ...Object.fromEntries(Object.keys(INTS).map((k) => [k, z.union([num, z.null()]).optional()])),
  ...Object.fromEntries(BOOLS.map((k) => [k, bool.optional()])),
  wpAppPassword: z.union([z.string().max(200), z.null()]).optional()
});

async function out(workspaceId: string, id: string) {
  const site = await prisma.seoBlogSite.findFirst({ where: { id, workspaceId }, include: { client: { select: { name: true } } } });
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  return siteOut(site);
}

export const GET = withApi({ module: "seo" }, async (_req, { params, api }) => {
  const site = await requireOwnSite(api, params.id);
  return NextResponse.json(await out(api.workspaceId, site.id));
});

export const PATCH = withApi({ module: "seo" }, async (req, { params, api }) => {
  const site = await requireOwnSite(api, params.id);
  const b = (await parseBody(req, Body)) as Record<string, any>;
  const data: Record<string, any> = {};
  for (const k of TEXT) if (typeof b[k] === "string") data[k] = b[k].trim().slice(0, 500);
  for (const k of LONG) if (k in b && b[k] !== undefined) data[k] = b[k] == null ? null : String(b[k]).slice(0, 20000);
  for (const [k, [min, max]] of Object.entries(INTS)) {
    if (b[k] === undefined || b[k] === null || Number.isNaN(b[k])) continue;
    data[k] = Math.max(min, Math.min(max, Math.round(Number(b[k]) || 0)));
  }
  for (const k of BOOLS) if (b[k] !== undefined) data[k] = b[k];
  if (typeof data.siteUrl === "string") data.siteUrl = normalizeSiteUrl(data.siteUrl);
  if (typeof b.wpAppPassword === "string" && b.wpAppPassword.trim()) data.wpAppPasswordEnc = encryptSecret(b.wpAppPassword.trim());
  if (data.publishTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.publishTime)) delete data.publishTime;
  if (data.language && !LANGUAGES.includes(data.language)) delete data.language;
  if (data.imageAspect && !ASPECTS.includes(data.imageAspect)) delete data.imageAspect;
  if (data.color !== undefined && !/^#[0-9a-f]{6}$/i.test(data.color)) delete data.color;
  if (data.ctaUrl && !/^https?:\/\//i.test(data.ctaUrl)) throw new ApiError(400, "validation_error", "La URL de la llamada a la acción debe empezar por https://");
  const wMin = data.wordsMin ?? site.wordsMin;
  const wMax = data.wordsMax ?? site.wordsMax;
  if (wMax < wMin) data.wordsMax = Math.min(8000, wMin + 400);

  // La conexión con WordPress solo la cambia un administrador (los demás campos, cualquiera).
  const changesConnection =
    (data.siteUrl !== undefined && data.siteUrl !== site.siteUrl) ||
    (data.wpUser !== undefined && data.wpUser !== site.wpUser) ||
    data.wpAppPasswordEnc !== undefined;
  if (changesConnection) requireAdminRole(api);
  else for (const k of CONNECTION) delete data[k];

  if ("siteUrl" in data || "wpUser" in data || "wpAppPasswordEnc" in data) data.siteCacheAt = null;
  const r = await prisma.seoBlogSite.updateMany({ where: { id: site.id, workspaceId: api.workspaceId }, data });
  if (!r.count) throw new ApiError(404, "not_found", "No encontrado");
  return NextResponse.json(await out(api.workspaceId, site.id));
});

/**
 * Borra los datos del Publicador del negocio (palabras clave, referencias, posts y registro).
 * No toca nada en su WordPress ni en la ficha de marca. La web se vuelve a crear vacía al entrar.
 */
export const DELETE = withApi({ module: "seo", admin: true, rate: "destructive" }, async (_req, { params, api }) => {
  const site = await requireOwnSite(api, params.id);
  const refs = await prisma.seoBlogRef.findMany({ where: { siteId: site.id, workspaceId: api.workspaceId }, select: { s3Key: true } });
  const posts = await prisma.seoBlogPost.findMany({ where: { siteId: site.id, workspaceId: api.workspaceId }, select: { images: true } });
  const r = await prisma.seoBlogSite.deleteMany({ where: { id: site.id, workspaceId: api.workspaceId } });
  if (!r.count) throw new ApiError(404, "not_found", "No encontrado");
  await prisma.seoBlogLog.deleteMany({ where: { workspaceId: api.workspaceId, siteId: site.id } });
  const keys = [
    ...refs.map((x) => x.s3Key),
    ...posts.flatMap((p) => (Array.isArray(p.images) ? (p.images as any[]).map((i) => String(i?.s3Key ?? "")) : []))
  ].filter((k) => k && k.startsWith(`${api.workspaceId}/`));
  await Promise.all(keys.map((k) => deleteObject(k).catch(() => null)));
  return NextResponse.json({ ok: true });
});
