/**
 * POST /api/v1/brand/upload  (multipart: file, kind)
 *
 * Sube un recurso de la ficha de marca: logo, imagen de referencia, plantilla
 * visual o fuente. Sustituye al /api/v1/files/upload genérico que usaba la
 * ficha editorial del Hub. Devuelve { url } firmada con validez larga
 * (ASSET_URL_TTL) para guardarla en la ficha.
 */

import { NextResponse } from "next/server";
import sharp from "sharp";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildS3Key, signedDownloadUrl, uploadBuffer } from "@/lib/storage/r2";
import { ASSET_URL_TTL, ensureContentBrand } from "@/lib/content/brand";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KINDS = ["logo", "reference", "template", "font"] as const;
type Kind = (typeof KINDS)[number];

const FONT_TYPES: Record<string, { ext: string; contentType: string }> = {
  ttf: { ext: "ttf", contentType: "font/ttf" },
  otf: { ext: "otf", contentType: "font/otf" },
  woff: { ext: "woff", contentType: "font/woff" },
  woff2: { ext: "woff2", contentType: "font/woff2" }
};

/** Comprueba la firma binaria de la fuente (no basta con la extensión). */
function looksLikeFont(buf: Buffer, ext: string): boolean {
  if (buf.length < 12) return false;
  const tag = buf.subarray(0, 4).toString("latin1");
  if (ext === "woff") return tag === "wOFF";
  if (ext === "woff2") return tag === "wOF2";
  if (ext === "otf") return tag === "OTTO" || buf.readUInt32BE(0) === 0x00010000;
  return buf.readUInt32BE(0) === 0x00010000 || tag === "true" || tag === "OTTO";
}

async function signLong(key: string): Promise<string> {
  try {
    return await signedDownloadUrl(key, ASSET_URL_TTL);
  } catch {
    // S3 sin URL pública no admite firmas de más de 7 días: se re-firma al leer.
    return signedDownloadUrl(key, 7 * 24 * 60 * 60);
  }
}

export const POST = withApi({ module: "editorial" }, async (req, { api }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const rawKind = String(form?.get("kind") ?? "reference");
  const kind: Kind = (KINDS as readonly string[]).includes(rawKind) ? (rawKind as Kind) : "reference";
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "missing_file", "Selecciona un archivo.");
  const brand = await ensureContentBrand(api.workspaceId);
  const input = Buffer.from(await file.arrayBuffer());

  if (kind === "font") {
    if (file.size > 10 * 1024 * 1024) throw new ApiError(400, "file_too_large", "La fuente supera 10 MB.");
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const type = FONT_TYPES[ext];
    if (!type || !looksLikeFont(input, ext)) throw new ApiError(400, "invalid_font", "Sube una fuente .ttf, .otf, .woff o .woff2.");
    const key = buildS3Key({ workspaceId: api.workspaceId, targetType: "brand", targetId: brand.id, filename: `font.${type.ext}` });
    await uploadBuffer({ s3Key: key, body: input, contentType: type.contentType });
    return NextResponse.json({ url: await signLong(key), name: file.name.replace(/\.[^.]+$/, "") }, { status: 201 });
  }

  if (!file.type.startsWith("image/")) throw new ApiError(400, "invalid_file", "Sube una imagen (PNG, JPG, WebP o SVG).");
  if (file.size > 20 * 1024 * 1024) throw new ApiError(400, "file_too_large", "La imagen supera 20 MB.");
  let body: Buffer;
  let contentType: string;
  let ext: string;
  try {
    const img = sharp(input, { limitInputPixels: 40_000_000 }).rotate();
    if (kind === "logo") {
      // PNG para conservar la transparencia (el logo se compone encima).
      body = await img.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      contentType = "image/png";
      ext = "png";
    } else {
      body = await img.resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      contentType = "image/jpeg";
      ext = "jpg";
    }
  } catch {
    throw new ApiError(400, "invalid_image", "No se pudo leer la imagen. Usa JPG, PNG, WebP o SVG.");
  }
  const key = buildS3Key({ workspaceId: api.workspaceId, targetType: "brand", targetId: brand.id, filename: `${kind}.${ext}` });
  await uploadBuffer({ s3Key: key, body, contentType });
  return NextResponse.json({ url: await signLong(key) }, { status: 201 });
});
