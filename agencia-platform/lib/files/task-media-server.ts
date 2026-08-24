import { ApiError } from "@/lib/api/auth";
import { extractTaskMediaFileIds, TASK_MEDIA_MIME_TYPES } from "@/lib/editor/task-media";

export async function validateTaskMedia(
  db: any,
  input: { description?: string | null; workspaceId: string; userId?: string | null; taskId?: string }
) {
  const fileIds = extractTaskMediaFileIds(input.description);
  if (fileIds.length > 100) throw new ApiError(400, "too_many_media", "Una tarea admite como máximo 100 archivos multimedia");
  if (!fileIds.length) return [];
  const files = await db.file.findMany({ where: { id: { in: fileIds }, workspaceId: input.workspaceId } });
  if (files.length !== fileIds.length) throw new ApiError(400, "invalid_media", "Algún archivo multimedia no existe o pertenece a otro espacio de trabajo");
  for (const file of files) {
    if (!TASK_MEDIA_MIME_TYPES.has(file.mimeType)) throw new ApiError(400, "invalid_media_type", `Formato multimedia no permitido: ${file.name}`);
    const isCurrentTask = file.targetType === "TASK" && file.targetId === input.taskId;
    const isDraft = !file.targetType && !file.targetId && file.uploadedBy === input.userId;
    if (!isCurrentTask && !isDraft) throw new ApiError(403, "media_forbidden", `No puedes usar el archivo ${file.name} en esta tarea`);
  }
  return files;
}

export async function claimTaskMedia(db: any, files: Array<{ id: string; targetType: string | null; targetId: string | null }>, taskId: string) {
  const draftIds = files.filter((file) => !file.targetType && !file.targetId).map((file) => file.id);
  if (draftIds.length) {
    const claimed = await db.file.updateMany({ where: { id: { in: draftIds }, targetType: null, targetId: null }, data: { targetType: "TASK", targetId: taskId } });
    if (claimed.count !== draftIds.length) throw new ApiError(409, "media_claim_conflict", "Otro guardado ha utilizado uno de los archivos. Vuelve a insertarlo.");
  }
}

export async function detachRemovedTaskMedia(db: any, previousDescription: string | null | undefined, nextDescription: string | null | undefined, taskId: string) {
  const next = new Set(extractTaskMediaFileIds(nextDescription));
  const removed = extractTaskMediaFileIds(previousDescription).filter((id) => !next.has(id));
  if (removed.length) {
    await db.file.updateMany({ where: { id: { in: removed }, targetType: "TASK", targetId: taskId }, data: { targetType: null, targetId: null } });
  }
}
