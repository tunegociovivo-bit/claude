/**
 * Helper para que Sonia (y otros flujos server-side) adjunte
 * archivos a una task. Sube a R2 + crea registro en `File` con
 * targetType=TASK + targetId=taskId. Firmado como el user de Sonia
 * para que aparezca como "subido por Sonia" en la UI.
 *
 * Devuelve el File ya persistido (con id, s3Key, etc.) para que
 * el caller pueda construir links o notificar.
 */

import { prisma } from "@/lib/db/prisma";
import { uploadBuffer, buildS3Key, isStorageEnabled } from "@/lib/storage/r2";

export type UploadAttachmentResult = {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
};

export async function uploadAttachmentForTask(opts: {
  workspaceId: string;
  taskId: string;
  filename: string;
  body: Buffer | Uint8Array;
  mimeType: string;
  uploadedByUserId?: string | null;
}): Promise<UploadAttachmentResult> {
  if (!isStorageEnabled()) {
    throw new Error(
      "Storage (R2) no configurado en el workspace — falta env CLOUDFLARE_R2_* o equivalente."
    );
  }
  // Verificación: la task pertenece al workspace (defensa en
  // profundidad — el caller ya debería filtrar pero por si acaso).
  const task = await prisma.task.findFirst({
    where: { id: opts.taskId, workspaceId: opts.workspaceId },
    select: { id: true }
  });
  if (!task) {
    throw new Error(`Task ${opts.taskId} no existe o no pertenece al workspace`);
  }

  const buf = opts.body instanceof Buffer ? opts.body : Buffer.from(opts.body);
  const s3Key = buildS3Key({
    workspaceId: opts.workspaceId,
    targetType: "TASK",
    targetId: opts.taskId,
    filename: opts.filename
  });

  await uploadBuffer({ s3Key, body: buf, contentType: opts.mimeType });

  const file = await prisma.file.create({
    data: {
      workspaceId: opts.workspaceId,
      name: opts.filename,
      mimeType: opts.mimeType,
      sizeBytes: buf.length,
      s3Key,
      targetType: "TASK",
      targetId: opts.taskId,
      uploadedBy: opts.uploadedByUserId ?? null
    },
    select: { id: true, name: true, mimeType: true, sizeBytes: true, s3Key: true }
  });

  return {
    fileId: file.id,
    filename: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    s3Key: file.s3Key
  };
}
