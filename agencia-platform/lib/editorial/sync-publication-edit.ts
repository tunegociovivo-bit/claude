import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api/auth";

/** Caller must use a transaction. Lock order is post first, then destinations. */
export async function lockEditorialEdit(tx: Prisma.TransactionClient, postId: string, workspaceId: string) {
  await tx.$queryRaw`SELECT "id" FROM "EditorialPost" WHERE "id" = ${postId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "EditorialPublication" WHERE "postId" = ${postId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
  const post = await tx.editorialPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post) throw new ApiError(404, "not_found", "Publicación no encontrada");
  const channels = await tx.editorialPublication.findMany({ where: { postId, workspaceId } });
  if (channels.some((channel) => channel.status === "PUBLISHING")) {
    throw new ApiError(409, "publishing_in_progress", "La publicación se está enviando. Espera a que termine antes de editarla.");
  }
  return { post, channels };
}

export async function syncPublicationEdit(
  tx: Prisma.TransactionClient,
  locked: Awaited<ReturnType<typeof lockEditorialEdit>>,
  data: { clientId?: string | null; status?: string; scheduledFor?: Date | null },
  userId?: string | null
) {
  const cancel = (data.clientId !== undefined && data.clientId !== locked.post.clientId) ||
    (data.status === "PUBLISHED" && locked.post.status !== "PUBLISHED") ||
    (data.status !== undefined && ["DRAFT", "REVIEW", "ARCHIVED"].includes(data.status));
  const live = locked.channels.filter((channel) => ["PENDING", "SCHEDULED", "FAILED"].includes(channel.status));
  if (!cancel && data.scheduledFor !== undefined && live.some((channel) => ["PENDING", "SCHEDULED"].includes(channel.status))) {
    if (!data.scheduledFor || data.scheduledFor.getTime() <= Date.now()) {
      throw new ApiError(400, "invalid_schedule", "Elige una fecha futura para las publicaciones pendientes de envío.");
    }
  }
  for (const channel of live) {
    if (!cancel && (data.scheduledFor === undefined || channel.status === "FAILED")) continue;
    const status = cancel ? "CANCELLED" : "SCHEDULED";
    const meta = channel.metaJson && typeof channel.metaJson === "object" && !Array.isArray(channel.metaJson) ? channel.metaJson : {};
    const history = Array.isArray(meta.history) ? meta.history : [];
    await tx.editorialPublication.update({
      where: { id: channel.id },
      data: {
        status,
        scheduledFor: cancel ? null : data.scheduledFor,
        metaJson: { ...meta, history: [...history, { status, at: new Date().toISOString(), userId: userId ?? null, reason: cancel ? "Publicación editada: envío cancelado" : "Fecha cambiada desde el calendario", scheduledFor: cancel ? null : data.scheduledFor?.toISOString() ?? null }] }
      }
    });
  }
}
