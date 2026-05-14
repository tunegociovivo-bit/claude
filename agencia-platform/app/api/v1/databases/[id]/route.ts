import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const patchSchema = z.object({ name: z.string().optional(), icon: z.string().optional() });

export const GET = withApi({ scope: "databases:read" }, async (_req, { params, api }) => {
  const db = await prisma.database.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    include: {
      properties: { orderBy: { order: "asc" } },
      views: { orderBy: { order: "asc" } }
    }
  });
  if (!db) throw new ApiError(404, "not_found", "Database no encontrada");
  return NextResponse.json(db);
});

export const PATCH = withApi({ scope: "databases:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const upd = await prisma.database.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: parsed.data
  });
  if (upd.count === 0) throw new ApiError(404, "not_found", "Database no encontrada");
  return NextResponse.json(await prisma.database.findUnique({ where: { id: params.id } }));
});

export const DELETE = withApi({ scope: "databases:write" }, async (_req, { params, api }) => {
  const del = await prisma.database.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (del.count === 0) throw new ApiError(404, "not_found", "Database no encontrada");
  return NextResponse.json({ ok: true });
});
