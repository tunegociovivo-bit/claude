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
        status: z.string().min(1).optional()
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

  // Solo tareas VIVAS (deletedAt: null) del workspace. Antes no se filtraba por
  // deletedAt, así que un cliente con estado desfasado podía reordenar/cambiar de
  // columna tareas ya borradas (papelera) o devolverlas a una columna. Ahora se
  // ignoran en silencio: nunca tocamos tareas borradas y no rompemos por ids
  // obsoletos del cliente.
  const liveTasks = await prisma.task.findMany({
    where: { id: { in: ids }, workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true }
  });
  const liveIds = new Set(liveTasks.map((t) => t.id));
  const liveItems = items.filter((it) => liveIds.has(it.id));
  if (liveItems.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  await prisma.$transaction(
    liveItems.map((it) =>
      // updateMany (no update) para poder exigir deletedAt: null en el WHERE.
      prisma.task.updateMany({
        where: { id: it.id, workspaceId: api.workspaceId, deletedAt: null },
        data: {
          order: it.order,
          ...(it.status ? { status: it.status, completedAt: it.status === "DONE" ? new Date() : null } : {})
        }
      })
    )
  );

  return NextResponse.json({ ok: true, count: liveItems.length });
});
