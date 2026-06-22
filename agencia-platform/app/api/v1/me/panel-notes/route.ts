/**
 * Notas personales (post-it) del tablón del panel de tareas.
 * GET  → lista las notas del usuario logueado (ordenadas por `order`).
 * POST → crea una nota nueva (vacía por defecto) al final del tablón.
 *
 * Son privadas por usuario: nunca se devuelven notas de otros miembros
 * aunque compartan workspace.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const COLORS = ["amber", "sky", "rose", "emerald", "violet", "slate"] as const;

const createSchema = z.object({
  content: z.string().max(5000).optional(),
  color: z.enum(COLORS).optional()
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const notes = await prisma.panelNote.findMany({
    where: { workspaceId: api.workspaceId, userId: api.userId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, content: true, color: true, order: true, updatedAt: true }
  });
  return NextResponse.json({ items: notes });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Nueva nota al final: order = (máximo actual) + 1.
  const last = await prisma.panelNote.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId },
    orderBy: { order: "desc" },
    select: { order: true }
  });

  const note = await prisma.panelNote.create({
    data: {
      workspaceId: api.workspaceId,
      userId: api.userId,
      content: parsed.data.content ?? "",
      color: parsed.data.color ?? "amber",
      order: (last?.order ?? 0) + 1
    },
    select: { id: true, content: true, color: true, order: true, updatedAt: true }
  });
  return NextResponse.json(note, { status: 201 });
});
