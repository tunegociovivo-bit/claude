import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

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
  return NextResponse.json(comment, { status: 201 });
});
