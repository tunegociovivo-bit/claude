import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildS3Key, isStorageEnabled, uploadBuffer, signedDownloadUrl } from "@/lib/storage/r2";

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const form = await req.formData().catch(() => null);
  const clientId = form?.get("clientId");
  const file = form?.get("file");
  if (typeof clientId !== "string") throw new ApiError(400, "missing_client", "Selecciona un cliente.");
  const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId: api.workspaceId, deletedAt: null }, select: { id: true } });
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado.");
  if (!(file instanceof File) || !file.type.startsWith("image/")) throw new ApiError(400, "invalid_file", "Sube una imagen.");
  if (file.size > 20 * 1024 * 1024) throw new ApiError(400, "file_too_large", "La imagen supera 20 MB.");
  if (!isStorageEnabled()) throw new ApiError(503, "storage_disabled", "Almacenamiento no configurado.");
  let image: Buffer;
  try {
    image = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  } catch {
    throw new ApiError(400, "invalid_image", "No se pudo leer la imagen. Usa JPG, PNG o WebP.");
  }
  const s3Key = buildS3Key({ workspaceId: api.workspaceId, targetType: "editorial-references", targetId: clientId, filename: "reference.jpg" });
  await uploadBuffer({ s3Key, body: image, contentType: "image/jpeg" });
  return NextResponse.json({ url: await signedDownloadUrl(s3Key) }, { status: 201 });
});
