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
  const urls = parseMediaUrls(current).filter((item) => mediaIdentity(item) !== mediaIdentity(url));
  return JSON.stringify([url, ...urls].slice(0, 30));
}

export function mediaIdentity(url: string): string {
  try { const parsed = new URL(url); return parsed.origin + parsed.pathname; }
  catch { return url; }
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
  if (!opts.fallbackUrl) throw new Error("La publicación no tiene imagen.");
  const versions = await prisma.editorialMediaVersion.findMany({
    where: { postId: opts.postId, workspaceId: opts.workspaceId, kind: "image" }
  });
  const identity = (url: string) => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return url; } };
  const selected = versions.find((v) => identity(v.url) === identity(opts.fallbackUrl!));
  if (selected?.s3Key) return downloadBuffer(selected.s3Key);
  // Legacy images are resolved only against our configured storage, never fetched from arbitrary URLs.
  const key = editorialStorageKey(opts.fallbackUrl, opts.workspaceId);
  if (!key) throw new Error("Sube la imagen al Hub antes de editarla o redimensionarla.");
  // Capture legacy originals once, before the first edit/resize can replace their thumbnail.
  await registerEditorialMediaVersion({ workspaceId: opts.workspaceId, postId: opts.postId,
    kind: "image", source: "uploaded", url: opts.fallbackUrl, s3Key: key });
  return downloadBuffer(key);
}

export function editorialStorageKey(url: string, workspaceId: string): string | null {
  try {
    const target = new URL(url);
    const bases = [process.env.STORAGE_PUBLIC_URL, process.env.STORAGE_ENDPOINT].filter(Boolean) as string[];
    for (const base of bases) {
      const allowed = new URL(base);
      const bucket = process.env.STORAGE_BUCKET;
      const virtualHost = bucket ? `${bucket}.${allowed.hostname}` : "";
      if (target.protocol !== allowed.protocol || target.port !== allowed.port ||
          (target.hostname !== allowed.hostname && target.hostname !== virtualHost)) continue;
      let path = decodeURIComponent(target.pathname).replace(/^\/+/, "");
      const prefix = allowed.pathname.replace(/^\/+|\/+$/g, "");
      if (prefix) { if (!path.startsWith(prefix + "/")) continue; path = path.slice(prefix.length + 1); }
      if (bucket && path.startsWith(bucket + "/")) path = path.slice(bucket.length + 1);
      if (path.startsWith(workspaceId + "/") && !path.split("/").includes("..")) return path;
    }
  } catch { /* Invalid URLs cannot identify stored media. */ }
  return null;
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
  preview?: boolean;
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
  let resized = await sharp(input)
    .rotate()
    .resize({
      width,
      height,
      fit: fit === "fill" ? "contain" : fit,
      background: opts.background ?? "#ffffff"
    })
    .png()
    .toBuffer();
  if (fit === "fill") {
    const foreground = await sharp(input).rotate().resize({ width, height, fit: "inside" }).png().toBuffer();
    resized = await sharp(input).rotate().resize({ width, height, fit: "cover" }).blur(24)
      .composite([{ input: foreground, gravity: "centre" }]).png().toBuffer();
  }
  if (opts.preview) return { url: `data:image/png;base64,${resized.toString("base64")}`, s3Key: null, width, height, fit, preview: true };
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
