import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { extractMentionTokens, resolveMentions } from "@/lib/mentions";
import { sendPushToUser } from "@/lib/push/web-push";

const commentCreateSchema = z.object({
  body: z.string().min(1).max(8000)
});

export const GET = withApi({ scope: "tasks:read" }, async (_req, { params, api }) => {
  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");

  const items = await prisma.comment.findMany({
    where: { workspaceId: api.workspaceId, targetType: "TASK", targetId: params.id },
    include: { author: { select: { id: true, name: true, image: true } } },
    orderBy: { createdAt: "asc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Se requiere usuario autenticado para comentar");

  const body = await req.json().catch(() => null);
  const parsed = commentCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");

  const comment = await prisma.comment.create({
    data: {
      workspaceId: api.workspaceId,
      authorId: api.userId,
      targetType: "TASK",
      targetId: params.id,
      body: parsed.data.body
    },
    include: { author: { select: { id: true, name: true, image: true } } }
  });

  // Resolver @menciones contra miembros del workspace y disparar notificaciones
  const tokens = extractMentionTokens(parsed.data.body);
  if (tokens.length > 0) {
    const workspaceUsers = await prisma.user.findMany({
      where: { memberships: { some: { workspaceId: api.workspaceId } } },
      select: { id: true, email: true, name: true }
    });
    const mentioned = resolveMentions(tokens, workspaceUsers).filter((u) => u.id !== api.userId);
    if (mentioned.length > 0) {
      const taskInfo = await prisma.task.findUnique({
        where: { id: params.id },
        select: { title: true }
      });
      const notifBody = `${comment.author.name ?? "Alguien"} te mencionó en "${taskInfo?.title ?? "una tarea"}"`;
      const link = `/tareas?task=${params.id}`;
      await prisma.notification.createMany({
        data: mentioned.map((u) => ({
          userId: u.id,
          type: "mention",
          body: notifBody,
          link
        }))
      });
      // Web push paralelo — best-effort, no bloqueante
      await Promise.all(
        mentioned.map((u) =>
          sendPushToUser(u.id, {
            title: "Te han mencionado",
            body: notifBody,
            link,
            tag: `mention-${params.id}`
          }).catch((e) => console.warn("[push] mention fallo:", e?.message ?? e))
        )
      );
    }
  }

  return NextResponse.json(comment, { status: 201 });
});
