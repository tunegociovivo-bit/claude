/**
 * Hilo de mensajes en una pieza editorial — visión del equipo (admin
 * o miembro autenticado). Complementa el endpoint público
 * /api/public/approval/[token]/messages que usa el cliente.
 *
 * GET  → mensajes del hilo (cronológico)
 * POST { body } → responde el equipo. authorType="TEAM", authorId =
 *   user logueado. No envía push (el cliente no recibe push porque
 *   no tiene login). Si en el futuro queremos avisar por email al
 *   cliente, lo conectamos aquí.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "tasks:read" }, async (_req, { params, api }) => {
  const post = await prisma.editorialPost.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (!post) throw new ApiError(404, "not_found", "Post no encontrado");

  const items = await prisma.editorialPostMessage.findMany({
    where: { postId: params.id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, image: true } } }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Se requiere usuario autenticado");

  const body = await req.json().catch(() => null);
  const text = (body?.body as string | undefined)?.trim();
  if (!text) throw new ApiError(400, "validation", "Body requerido");
  if (text.length > 4000) throw new ApiError(400, "too_long", "Mensaje demasiado largo");

  const post = await prisma.editorialPost.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (!post) throw new ApiError(404, "not_found", "Post no encontrado");

  const msg = await prisma.editorialPostMessage.create({
    data: {
      postId: params.id,
      authorType: "TEAM",
      authorId: api.userId,
      body: text
    },
    include: { author: { select: { id: true, name: true, image: true } } }
  });
  return NextResponse.json(msg, { status: 201 });
});
