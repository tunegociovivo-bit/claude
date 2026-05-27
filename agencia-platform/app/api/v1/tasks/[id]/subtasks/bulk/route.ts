/**
 * POST /api/v1/tasks/[id]/subtasks/bulk
 *
 * Crea de golpe una lista de subtareas bajo la tarea especificada.
 * Usado por el modal de "Grabar reunión": los action_items detectados
 * por la IA se pueden convertir en subtareas con un click.
 *
 * El status, projectId y clientId se heredan de la tarea padre para
 * que el equipo no tenga que reasignarlos a mano. El `assignee` que
 * la IA detecta como string (nombre) NO se aplica automáticamente
 * — preferimos no equivocarnos con un match difuso. Si se reconoce
 * el nombre contra un miembro del workspace, lo aplicamos; si no,
 * se deja sin asignar y el equipo lo arregla.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(500),
        assignee: z.string().nullable().optional(),
        due: z.string().nullable().optional()
      })
    )
    .min(1)
    .max(50)
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const parent = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, status: true, projectId: true, clientId: true }
  });
  if (!parent) throw new ApiError(404, "not_found", "Tarea padre no encontrada");

  // Match difuso de assignee → si el nombre coincide (case-insensitive,
  // sin tildes) con un miembro del workspace, lo asignamos. Si no, la
  // subtarea queda sin asignar.
  const members = await prisma.user.findMany({
    where: { memberships: { some: { workspaceId: api.workspaceId } } },
    select: { id: true, name: true, email: true }
  });
  function lookupAssignee(name?: string | null): string | null {
    if (!name) return null;
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim();
    const target = norm(name);
    const hit = members.find(
      (m) => norm(m.name ?? "") === target || norm(m.email).split("@")[0] === target
    );
    return hit?.id ?? null;
  }

  const created = [];
  for (const it of parsed.data.items) {
    const assigneeId = lookupAssignee(it.assignee);
    const due = it.due && /^\d{4}-\d{2}-\d{2}$/.test(it.due) ? new Date(it.due) : null;
    const sub = await prisma.task.create({
      data: {
        workspaceId: api.workspaceId,
        title: it.title,
        status: "TODO",
        parentId: parent.id,
        projectId: parent.projectId,
        clientId: parent.clientId,
        dueDate: due,
        ...(assigneeId ? { assignees: { create: [{ userId: assigneeId }] } } : {})
      } as any
    });
    created.push(sub);
  }

  return NextResponse.json({ items: created }, { status: 201 });
});
