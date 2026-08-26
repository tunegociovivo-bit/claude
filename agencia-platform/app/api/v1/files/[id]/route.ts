import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { deleteObject, isStorageEnabled, signedDownloadUrl } from "@/lib/storage/r2";
import { taskVisibilityWhere } from "@/lib/api/task-access";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const file = await prisma.file.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!file) throw new ApiError(404, "not_found", "Archivo no encontrado");
  if (file.targetType === "SUBVENCION_VAULT") await requireVaultAdmin(api.workspaceId, api.userId);
  if (file.targetType === "TASK" && !file.targetId) throw new ApiError(404, "not_found", "Archivo no encontrado");
  if (!file.targetType && file.uploadedBy !== api.userId) throw new ApiError(404, "not_found", "Archivo no encontrado");
  if (file.targetType === "TASK" && file.targetId) {
    const visibility = await taskVisibilityWhere(api.workspaceId, api.userId);
    const task = await prisma.task.findFirst({
      where: { id: file.targetId, workspaceId: api.workspaceId, deletedAt: null, ...(visibility ? { AND: [visibility] } : {}) },
      select: { id: true }
    });
    if (!task) throw new ApiError(404, "not_found", "Archivo no encontrado");
  }
  return NextResponse.json({
    ...file,
    url: isStorageEnabled() ? await signedDownloadUrl(file.s3Key) : null
  });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const file = await prisma.file.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!file) throw new ApiError(404, "not_found", "Archivo no encontrado");
  if (file.targetType === "SUBVENCION_VAULT") await requireVaultAdmin(api.workspaceId, api.userId);

  if (file.targetType === "TASK" && file.targetId) {
    const visibility = await taskVisibilityWhere(api.workspaceId, api.userId);
    const task = await prisma.task.findFirst({
      where: { id: file.targetId, workspaceId: api.workspaceId, deletedAt: null, ...(visibility ? { AND: [visibility] } : {}) },
      select: { id: true }
    });
    if (!task) throw new ApiError(404, "not_found", "Archivo no encontrado");
  }

  // Solo el subidor o un admin pueden borrar
  if (api.userId && file.uploadedBy && file.uploadedBy !== api.userId) {
    const me = await prisma.membership.findFirst({
      where: { userId: api.userId, workspaceId: api.workspaceId }
    });
    if (!me || me.role !== "ADMIN") {
      throw new ApiError(403, "forbidden", "Solo quien subió el archivo o un admin puede borrarlo");
    }
  }

  if (isStorageEnabled()) {
    try {
      await deleteObject(file.s3Key);
    } catch (e) {
      console.warn("Borrado de objeto falló (sigue, borramos metadata):", e);
    }
  }
  await prisma.file.delete({ where: { id: file.id } });
  return NextResponse.json({ ok: true });
});

async function requireVaultAdmin(workspaceId: string, userId?: string) {
  if (!userId) throw new ApiError(401, "unauthorized", "Autenticación requerida");
  const membership = await prisma.membership.findFirst({
    where: { workspaceId, userId },
    select: { role: true }
  });
  if (membership?.role !== "ADMIN") throw new ApiError(403, "forbidden", "Acceso restringido a administradores");
}
