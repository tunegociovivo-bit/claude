import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const reorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        order: z.number().int().min(0),
        status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE", "CANCELLED"]).optional()
      })
    )
    .min(1)
    .max(500)
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { items } = parsed.data;
  const ids = items.map((i) => i.id);

  // Verificamos que todas las tareas pertenezcan al workspace activo
  const tasks = await prisma.task.findMany({
    where: { id: { in: ids }, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (tasks.length !== ids.length) {
    throw new ApiError(403, "forbidden", "Una o más tareas no pertenecen al workspace");
  }

  await prisma.$transaction(
    items.map((it) =>
      prisma.task.update({
        where: { id: it.id },
        data: {
          order: it.order,
          ...(it.status ? { status: it.status, completedAt: it.status === "DONE" ? new Date() : null } : {})
        }
      })
    )
  );

  return NextResponse.json({ ok: true, count: items.length });
});
