/**
 * Configuración del workspace activo: nombre, logo, slug.
 * GET: cualquier miembro del workspace
 * PATCH: solo admin
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  logo: z.string().url().nullable().optional()
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { id: true, name: true, slug: true, logo: true }
  });
  return NextResponse.json(ws ?? null);
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId }
  });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const data: any = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.logo !== undefined) data.logo = parsed.data.logo;

  const updated = await prisma.workspace.update({
    where: { id: api.workspaceId },
    data,
    select: { id: true, name: true, slug: true, logo: true }
  });
  return NextResponse.json(updated);
});
