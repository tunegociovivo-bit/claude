import { NextResponse } from "next/server";
import sharp from "sharp";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildS3Key, isStorageEnabled, uploadBuffer, signedDownloadUrl } from "@/lib/storage/r2";
import { ensureContentBrand } from "@/lib/content/brand";

/**
 * Sube una imagen de referencia para «Generar mes con IA» (referencias del
 * mes). CRM: la referencia queda bajo la marca del negocio; `clientId` del
 * formulario se ignora.
 */
export const POST = withApi({ module: "editorial" }, async (req, { api }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const brand = await ensureContentBrand(api.workspaceId);
  if (!(file instanceof File) || !file.type.startsWith("image/")) throw new ApiError(400, "invalid_file", "Sube una imagen.");
  if (file.size > 20 * 1024 * 1024) throw new ApiError(400, "file_too_large", "La imagen supera 20 MB.");
  if (!isStorageEnabled()) throw new ApiError(503, "storage_disabled", "Almacenamiento no configurado.");
  let image: Buffer;
  try {
    image = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  } catch {
    throw new ApiError(400, "invalid_image", "No se pudo leer la imagen. Usa JPG, PNG o WebP.");
  }
  const s3Key = buildS3Key({ workspaceId: api.workspaceId, targetType: "editorial-references", targetId: brand.id, filename: "reference.jpg" });
  await uploadBuffer({ s3Key, body: image, contentType: "image/jpeg" });
  return NextResponse.json({ url: await signedDownloadUrl(s3Key) }, { status: 201 });
});
