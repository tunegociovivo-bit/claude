/**
 * POST /api/v1/files/upload
 *
 * Sube un archivo en multipart/form-data DIRECTAMENTE al storage
 * desde el servidor (proxy). Alternativa al flow signed URL +
 * PUT desde el navegador, que requiere CORS configurado en R2/S3.
 *
 * Body multipart:
 *   file        — el binario
 *   targetType  — opcional, "TASK" | "DOCUMENT" | "CLIENT" | "PROJECT"
 *   targetId    — opcional
 *
 * Crea la fila File y devuelve el mismo shape que POST /api/v1/files
 * para que el CommentEditor lo trate igual.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildS3Key, isStorageEnabled, signedDownloadUrl, uploadBuffer } from "@/lib/storage/r2";
import { TASK_MEDIA_MIME_TYPES } from "@/lib/editor/task-media";
import { taskVisibilityWhere } from "@/lib/api/task-access";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export const POST = withApi({ scope: "*" }, async (req: NextRequest, { api }) => {
  if (!isStorageEnabled()) {
    throw new ApiError(503, "storage_disabled", "Storage no configurado. Define STORAGE_* en env.");
  }

  const form = await req.formData();
  const file = form.get("file");
  const targetType = form.get("targetType");
  const targetId = form.get("targetId");
  const purpose = form.get("purpose");

  if (purpose === "TASK_DESCRIPTION") {
    const isDraft = targetType === null && targetId === null;
    const isBoundTask = targetType === "TASK" && typeof targetId === "string" && targetId.trim().length > 0;
    if (!isDraft && !isBoundTask) {
      throw new ApiError(400, "invalid_target", "La multimedia debe ser un borrador o pertenecer a una tarea válida");
    }
  }

  if (!(file instanceof Blob)) {
    throw new ApiError(400, "no_file", "Falta el campo 'file'");
  }
  if (file.size === 0) throw new ApiError(400, "empty", "Archivo vacío");
  if (file.size > MAX_BYTES) {
    throw new ApiError(413, "too_large", `Archivo > 50 MB (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  }

  const name = (file as any).name && typeof (file as any).name === "string" ? (file as any).name : "upload";
  const mimeType = file.type || "application/octet-stream";
  if (purpose === "TASK_DESCRIPTION" && !TASK_MEDIA_MIME_TYPES.has(mimeType)) {
    throw new ApiError(400, "invalid_media_type", "Solo se permiten JPG, PNG, GIF, WebP, MP4 y WebM en la descripción");
  }
  if (purpose === "TASK_DESCRIPTION" && typeof targetId === "string") {
    const visibility = await taskVisibilityWhere(api.workspaceId, api.userId);
    const task = await prisma.task.findFirst({
      where: { id: targetId, workspaceId: api.workspaceId, deletedAt: null, ...(visibility ? { AND: [visibility] } : {}) },
      select: { id: true }
    });
    if (!task) throw new ApiError(404, "task_not_found", "La tarea no existe");
  }
  const buf = Buffer.from(await file.arrayBuffer());

  const s3Key = buildS3Key({
    workspaceId: api.workspaceId,
    targetType: typeof targetType === "string" ? targetType : undefined,
    targetId: typeof targetId === "string" ? targetId : undefined,
    filename: name
  });

  try {
    await uploadBuffer({ s3Key, body: buf, contentType: mimeType });
  } catch (e: any) {
    throw new ApiError(502, "upload_failed", `No se pudo subir al storage: ${e?.message ?? e}`);
  }

  const record = await prisma.file.create({
    data: {
      workspaceId: api.workspaceId,
      name,
      mimeType,
      sizeBytes: buf.length,
      s3Key,
      targetType: typeof targetType === "string" ? targetType : null,
      targetId: typeof targetId === "string" ? targetId : null,
      uploadedBy: api.userId
    }
  });

  return NextResponse.json(
    {
      ...record,
      url: await signedDownloadUrl(s3Key),
      isExternal: false
    },
    { status: 201 }
  );
});
