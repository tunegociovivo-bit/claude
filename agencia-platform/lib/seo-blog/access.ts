import { prisma } from "@/lib/db/prisma";
import { ApiError, type ApiContext } from "@/lib/api/auth";
import { userCanAccessPlatform } from "@/lib/platforms-server";
import { signedDownloadUrl } from "@/lib/storage/r2";
import type { SeoBlogPost, SeoBlogSite } from "@prisma/client";
import { STEP_LABELS } from "./pipeline";
import { asArray, asObject, utcToMadrid } from "./util";

/** Acceso a la plataforma "Publicador SEO" (config en /admin/plataformas). */
export async function requireSeoBlogAccess(api: ApiContext): Promise<void> {
  if (api.apiKeyId) return; // integraciones con API key del workspace
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  if (!(await userCanAccessPlatform(api.workspaceId, api.userId, "seo_publicador"))) {
    throw new ApiError(403, "forbidden", "No tienes acceso al Publicador SEO");
  }
}

export async function requireWorkspaceAdmin(api: ApiContext): Promise<void> {
  if (api.apiKeyId) return;
  const me = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId ?? "" }, select: { role: true } });
  if (me?.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo administradores");
}

export function siteOut(s: SeoBlogSite & { client?: { name: string } | null; _count?: any }) {
  const { wpAppPasswordEnc, siteCache, ...rest } = s as any;
  return { ...rest, clientName: s.client?.name ?? "", hasPassword: !!wpAppPasswordEnc, pagesIndexed: asArray(siteCache).length };
}

export function postLight(p: SeoBlogPost & { site?: { color: string; client: { name: string } } | null }) {
  const report = asObject<any>(p.seoReport);
  const imgs = asArray<any>(p.images);
  return {
    id: p.id,
    siteId: p.siteId,
    clientName: p.site?.client?.name ?? "",
    color: p.site?.color ?? "#C9962E",
    title: p.title,
    keyword: p.keyword,
    keywordId: p.keywordId,
    angle: p.angle,
    intent: p.intent,
    funnel: p.funnel,
    secondaryKeywords: asArray<string>(p.secondaryKeywords),
    rationale: p.rationale,
    notes: p.notes,
    status: p.status,
    step: p.step,
    stepLabel: STEP_LABELS[p.step] ?? p.step,
    publishAt: p.publishAt,
    publishAtLocal: utcToMadrid(p.publishAt),
    seoScore: p.seoScore,
    words: report?.stats?.words ?? 0,
    remoteUrl: p.remoteUrl,
    error: p.error,
    hasImage: imgs[0]?.status === "done",
    updatedAt: p.updatedAt
  };
}

export async function thumbFor(p: SeoBlogPost): Promise<string | null> {
  const img = asArray<any>(p.images)[0];
  if (img?.status !== "done" || !img.s3Key) return null;
  return signedDownloadUrl(img.s3Key, 3600).catch(() => null);
}
