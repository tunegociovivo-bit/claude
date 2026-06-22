/**
 * PATCH  → edita una nota (contenido / color).
 * DELETE → borra una nota.
 *
 * Siempre con doble candado workspaceId + userId: un usuario solo puede
 * tocar SUS notas, nunca las de otro miembro del workspace.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const COLORS = ["amber", "sky", "rose", "emerald", "violet", "slate"] as const;

const patchSchema = z.object({
  content: z.string().max(5000).optional(),
  color: z.enum(COLORS).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { api, params }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const id = params?.id as string;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const data: { content?: string; color?: string } = {};
  if (parsed.data.content !== undefined) data.content = parsed.data.content;
  if (parsed.data.color !== undefined) data.color = parsed.data.color;

  const result = await prisma.panelNote.updateMany({
    where: { id, workspaceId: api.workspaceId, userId: api.userId },
    data
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Nota no encontrada");

  const note = await prisma.panelNote.findUnique({
    where: { id },
    select: { id: true, content: true, color: true, order: true, updatedAt: true }
  });
  return NextResponse.json(note);
});

export const DELETE = withApi({ scope: "*" }, async (_req, { api, params }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const id = params?.id as string;
  const result = await prisma.panelNote.deleteMany({
    where: { id, workspaceId: api.workspaceId, userId: api.userId }
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Nota no encontrada");
  return NextResponse.json({ ok: true });
});
