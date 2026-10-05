import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ensureContentBrand } from "@/lib/content/brand";
import { requireOwnSite } from "@/lib/seo-blog/access";
import { storeReference } from "@/lib/seo-blog/service";
import { safeDownload } from "@/lib/seo-blog/net";
import { fetchAssetBuffer } from "@/lib/storage/fetch-asset";
import { keyFromFileUrl } from "@/lib/storage/r2";
import { resignUrlIfNeeded } from "@/lib/storage/resign";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_IMPORT = 12;

/** Identificador estable de una imagen (sin la firma de la URL) para no importarla dos veces. */
function sourceId(url: string): string {
  const own = keyFromFileUrl(url);
  let base = own ?? url;
  if (!own) {
    try {
      const u = new URL(url);
      base = `${u.host}${u.pathname}`;
    } catch {}
  }
  return createHash("sha1").update(base).digest("hex").slice(0, 16);
}

function parseUrls(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

const isImageUrl = (u: string) => !/\.(mp4|mov|webm|m4v|avi)(\?|$)/i.test(u);

/**
 * Copia como referencias visuales las imágenes que la marca ya tiene en el Editorial:
 * sus referencias de marca y las imágenes de sus publicaciones (las tablas existen aunque
 * el módulo Editorial esté apagado).
 */
export const POST = withApi({ module: "seo" }, async (_req, { params, api }) => {
  const site = await requireOwnSite(api, params.id);
  const brand = await ensureContentBrand(api.workspaceId);

  const candidates: string[] = [];
  const brandRefs = Array.isArray(brand.referenceImages) ? (brand.referenceImages as any[]) : [];
  for (const r of brandRefs) {
    const url = typeof r === "string" ? r : r?.url;
    if (typeof url === "string" && url) candidates.push(url);
  }
  const versions = await prisma.editorialMediaVersion.findMany({
    where: { workspaceId: api.workspaceId, kind: "image", post: { workspaceId: api.workspaceId, OR: [{ clientId: brand.id }, { clientId: null }] } },
    orderBy: { createdAt: "desc" },
    select: { url: true },
    take: 60
  });
  for (const v of versions) if (v.url) candidates.push(v.url);
  const posts = await prisma.editorialPost.findMany({
    where: { workspaceId: api.workspaceId, OR: [{ clientId: brand.id }, { clientId: null }] },
    orderBy: { updatedAt: "desc" },
    select: { thumbnail: true, mediaUrls: true },
    take: 60
  });
  for (const p of posts) {
    if (p.thumbnail) candidates.push(p.thumbnail);
    candidates.push(...parseUrls(p.mediaUrls));
  }

  const existing = new Set(
    (await prisma.seoBlogRef.findMany({ where: { workspaceId: api.workspaceId, siteId: site.id }, select: { label: true } }))
      .map((r) => r.label)
      .filter((l) => l.startsWith("editorial:"))
  );
  const seen = new Set<string>();
  const queue: { url: string; label: string }[] = [];
  for (const url of candidates) {
    if (!isImageUrl(url)) continue;
    const label = `editorial:${sourceId(url)}`;
    if (seen.has(label)) continue;
    seen.add(label);
    queue.push({ url, label });
  }
  const found = queue.length;
  if (!found) {
    return NextResponse.json({
      imported: 0,
      found: 0,
      skipped: 0,
      errors: [],
      message: "Tu marca aún no tiene imágenes en el Editorial (ni referencias de marca ni publicaciones con imagen). Sube aquí tus propias fotos."
    });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const it of queue) {
    if (imported >= MAX_IMPORT) break;
    if (existing.has(it.label)) {
      skipped++;
      continue;
    }
    try {
      const own = keyFromFileUrl(it.url);
      if (own && !own.startsWith(`${api.workspaceId}/`)) throw new Error("archivo de otro negocio");
      const buffer =
        own || it.url.startsWith("data:")
          ? (await fetchAssetBuffer(it.url, { timeoutMs: 30_000, maxBytes: 25 * 1024 * 1024 })).buffer
          : await safeDownload((await resignUrlIfNeeded(it.url)) ?? it.url, { timeoutMs: 30_000, maxBytes: 25 * 1024 * 1024 });
      await storeReference(api.workspaceId, site.id, buffer, `editorial-${imported + 1}.jpg`, it.label);
      imported++;
    } catch (e: any) {
      errors.push(e?.message ?? String(e));
    }
  }
  const message =
    imported > 0
      ? `${imported} imagen(es) importada(s) del Editorial${skipped ? ` (${skipped} ya estaban)` : ""}.`
      : skipped
        ? "Las imágenes del Editorial ya estaban importadas."
        : "No se pudo importar ninguna imagen del Editorial (las imágenes deben medir al menos 256×256 px).";
  return NextResponse.json({ imported, found, skipped, errors: errors.slice(0, 5), message });
});
