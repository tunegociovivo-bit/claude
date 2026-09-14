import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { buildS3Key, downloadBuffer, isStorageEnabled, signedDownloadUrl, uploadBuffer } from "@/lib/storage/r2";

export const EDITORIAL_IMAGE_PRESETS = {
  instagram_square: { width: 1080, height: 1080 },
  instagram_portrait: { width: 1080, height: 1350 },
  reel_story: { width: 1080, height: 1920 },
  facebook_feed: { width: 1200, height: 630 },
  linkedin_feed: { width: 1200, height: 1200 }
} as const;

export type EditorialImagePreset = keyof typeof EDITORIAL_IMAGE_PRESETS;
export type ResizeFit = "cover" | "contain" | "fill";

export function parseMediaUrls(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
}

export function prependMediaUrl(current: string | null | undefined, url: string): string {
  const urls = parseMediaUrls(current).filter((item) => item !== url);
  return JSON.stringify([url, ...urls].slice(0, 30));
}

export async function registerEditorialMediaVersion(opts: {
  workspaceId: string;
  postId: string;
  kind: "image" | "video";
  source: "uploaded" | "generated" | "edited" | "resized" | "video";
  url: string;
  s3Key?: string | null;
  width?: number | null;
  height?: number | null;
  prompt?: string | null;
  createdById?: string | null;
  metaJson?: unknown;
}) {
  return prisma.editorialMediaVersion.create({
    data: {
      workspaceId: opts.workspaceId,
      postId: opts.postId,
      kind: opts.kind,
      source: opts.source,
      url: opts.url,
      s3Key: opts.s3Key ?? null,
      width: opts.width ?? null,
      height: opts.height ?? null,
      prompt: opts.prompt ?? null,
      createdById: opts.createdById ?? null,
      metaJson: (opts.metaJson as any) ?? undefined
    }
  });
}

export async function attachEditorialImage(opts: {
  workspaceId: string;
  userId?: string | null;
  postId: string;
  file: File;
}) {
  if (!isStorageEnabled()) throw new Error("Storage no configurado. Configura STORAGE_* para subir imágenes.");
  if (!opts.file.type.startsWith("image/")) throw new Error("El archivo debe ser una imagen.");
  const ab = await opts.file.arrayBuffer();
  if (ab.byteLength > 20 * 1024 * 1024) throw new Error("La imagen supera 20MB.");
  const input = Buffer.from(ab);
  const meta = await sharp(input).metadata();
  const normalized = await sharp(input).rotate().png().toBuffer();
  const post = await prisma.editorialPost.findFirst({ where: { id: opts.postId, workspaceId: opts.workspaceId } });
  if (!post) throw new Error("Publicación no encontrada");
  const s3Key = buildS3Key({
    workspaceId: opts.workspaceId,
    targetType: "editorial",
    targetId: opts.postId,
    filename: `upload-${Date.now()}.png`
  });
  await uploadBuffer({ s3Key, body: normalized, contentType: "image/png" });
  const url = await signedDownloadUrl(s3Key);
  await prisma.editorialPost.update({
    where: { id: post.id },
    data: { thumbnail: url, mediaUrls: prependMediaUrl(post.mediaUrls, url) }
  });
  await registerEditorialMediaVersion({
    workspaceId: opts.workspaceId,
    postId: opts.postId,
    kind: "image",
    source: "uploaded",
    url,
    s3Key,
    width: meta.width ?? null,
    height: meta.height ?? null,
    createdById: opts.userId ?? null
  });
  return { url, s3Key, width: meta.width ?? null, height: meta.height ?? null };
}

export async function getLatestEditorialImageBuffer(opts: {
  postId: string;
  workspaceId: string;
  fallbackUrl?: string | null;
}): Promise<Buffer> {
  const latest = await prisma.editorialMediaVersion.findFirst({
    where: { postId: opts.postId, workspaceId: opts.workspaceId, kind: "image", s3Key: { not: null } },
    orderBy: { createdAt: "desc" }
  });
  if (latest?.s3Key) return downloadBuffer(latest.s3Key);
  if (!opts.fallbackUrl) throw new Error("La publicación no tiene imagen.");
  const resp = await fetch(opts.fallbackUrl, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`No pude descargar la imagen actual (${resp.status}).`);
  const ct = resp.headers.get("content-type") ?? "";
  if (!ct.startsWith("image/")) throw new Error("La URL actual no devuelve una imagen.");
  return Buffer.from(await resp.arrayBuffer());
}

export async function resizeEditorialImage(opts: {
  workspaceId: string;
  userId?: string | null;
  postId: string;
  preset?: EditorialImagePreset;
  width?: number;
  height?: number;
  fit?: ResizeFit;
  background?: string;
}) {
  if (!isStorageEnabled()) throw new Error("Storage no configurado. Configura STORAGE_* para guardar imágenes.");
  const post = await prisma.editorialPost.findFirst({ where: { id: opts.postId, workspaceId: opts.workspaceId } });
  if (!post) throw new Error("Publicación no encontrada");
  const preset = opts.preset ? EDITORIAL_IMAGE_PRESETS[opts.preset] : null;
  const width = preset?.width ?? opts.width;
  const height = preset?.height ?? opts.height;
  if (!width || !height || width < 100 || height < 100 || width > 4096 || height > 4096) {
    throw new Error("Dimensiones inválidas. Usa entre 100 y 4096 px.");
  }
  const input = await getLatestEditorialImageBuffer({ postId: opts.postId, workspaceId: opts.workspaceId, fallbackUrl: post.thumbnail });
  const fit = opts.fit ?? "cover";
  const resized = await sharp(input)
    .rotate()
    .resize({
      width,
      height,
      fit,
      background: opts.background ?? "#ffffff"
    })
    .png()
    .toBuffer();
  const s3Key = buildS3Key({
    workspaceId: opts.workspaceId,
    targetType: "editorial",
    targetId: opts.postId,
    filename: `resize-${width}x${height}-${Date.now()}.png`
  });
  await uploadBuffer({ s3Key, body: resized, contentType: "image/png" });
  const url = await signedDownloadUrl(s3Key);
  await prisma.editorialPost.update({
    where: { id: post.id },
    data: { thumbnail: url, mediaUrls: prependMediaUrl(post.mediaUrls, url) }
  });
  await registerEditorialMediaVersion({
    workspaceId: opts.workspaceId,
    postId: opts.postId,
    kind: "image",
    source: "resized",
    url,
    s3Key,
    width,
    height,
    createdById: opts.userId ?? null,
    metaJson: { fit, preset: opts.preset ?? null }
  });
  return { url, s3Key, width, height, fit };
}
