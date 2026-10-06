/**
 * Acceso y serialización del Publicador SEO en el CRM.
 *
 * Diferencias con el Hub: el acceso al módulo lo controla `withApi({ module: "seo" })`
 * (sustituye a requireSeoBlogAccess) y los permisos de administrador `admin: true` /
 * `requireAdminRole` (sustituye a requireWorkspaceAdmin). Cada negocio tiene UNA sola
 * web (SeoBlogSite) ligada a su ficha de marca, que se crea sola al primer acceso.
 */
import { prisma } from "@/lib/db/prisma";
import { ApiError, type ApiContext } from "@/lib/api/auth";
import { ensureContentBrand } from "@/lib/content/brand";
import { signedDownloadUrl } from "@/lib/storage/r2";
import type { SeoBlogPost, SeoBlogSite } from "@prisma/client";
import { STEP_LABELS } from "./pipeline";
import { normalizeSiteUrl } from "./wp";
import { asArray, asObject, utcToMadrid } from "./util";

const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Devuelve la web del Publicador del negocio; si no existe, la crea con los
 * datos de su ficha de marca (web, sector, información y color de acento).
 */
export async function ensureSeoSite(workspaceId: string): Promise<SeoBlogSite> {
  const brand = await ensureContentBrand(workspaceId);
  const existing = await prisma.seoBlogSite.findFirst({ where: { workspaceId, clientId: brand.id } });
  if (existing) return existing;
  try {
    return await prisma.seoBlogSite.create({
      data: {
        workspaceId,
        clientId: brand.id,
        siteUrl: normalizeSiteUrl(brand.website ?? ""),
        sector: (brand.industry ?? "").slice(0, 500),
        businessInfo: brand.brandBrief?.trim() || brand.infoGeneral?.trim() || null,
        competitors: brand.competitors ?? null,
        color: HEX_RE.test(brand.brandColorAccent ?? "") ? brand.brandColorAccent : "#2563EB",
        imagesPerPost: 3
      }
    });
  } catch {
    // Carrera entre dos peticiones (@@unique([workspaceId, clientId])): la otra ya la creó.
    const again = await prisma.seoBlogSite.findFirst({ where: { workspaceId, clientId: brand.id } });
    if (again) return again;
    throw new ApiError(500, "site_failed", "No se pudo preparar la web del Publicador SEO");
  }
}

/** La web del negocio, comprobando que `siteId` (de la URL o del cuerpo) es la suya. Si no → 404. */
export async function requireOwnSite(api: ApiContext, siteId: string | null | undefined): Promise<SeoBlogSite> {
  const site = await ensureSeoSite(api.workspaceId);
  if (!siteId || siteId !== site.id) throw new ApiError(404, "not_found", "No encontrado");
  return site;
}

export function siteOut(s: SeoBlogSite & { client?: { name: string } | null; _count?: any }) {
  const { wpAppPasswordEnc, siteCache, pairTokenHash, pairTokenAt, clientId, ...rest } = s as any;
  return { ...rest, brandName: s.client?.name ?? "", hasPassword: !!wpAppPasswordEnc, pagesIndexed: asArray(siteCache).length };
}

export function postLight(p: SeoBlogPost & { site?: { color: string } | null }) {
  const report = asObject<any>(p.seoReport);
  const imgs = asArray<any>(p.images);
  return {
    id: p.id,
    siteId: p.siteId,
    color: p.site?.color ?? "#2563EB",
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
  if (img?.status !== "done" || !img.s3Key || !String(img.s3Key).startsWith(`${p.workspaceId}/`)) return null;
  return signedDownloadUrl(img.s3Key, 3600).catch(() => null);
}
