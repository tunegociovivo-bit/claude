import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const DELETE = withApi({ scope: "tasks:write" }, async (_req, { params, api }) => {
  // Solo el autor (o admin del workspace) puede borrar
  const comment = await prisma.comment.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!comment) throw new ApiError(404, "not_found", "Comentario no encontrado");

  if (api.userId && comment.authorId !== api.userId) {
    const me = await prisma.membership.findFirst({
      where: { userId: api.userId, workspaceId: api.workspaceId }
    });
    if (!me || (me.role !== "ADMIN")) {
      throw new ApiError(403, "forbidden", "Solo el autor o un admin puede borrar este comentario");
    }
  }

  await prisma.comment.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
