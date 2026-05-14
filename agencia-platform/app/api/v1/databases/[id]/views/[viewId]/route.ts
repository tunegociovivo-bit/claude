import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const patchSchema = z.object({
  name: z.string().optional(),
  config: z.any().optional(),
  order: z.number().int().optional()
});

export const PATCH = withApi({ scope: "databases:write" }, async (req, { params, api }) => {
  const view = await prisma.databaseView.findFirst({
    where: { id: params.viewId, database: { id: params.id, workspaceId: api.workspaceId } }
  });
  if (!view) throw new ApiError(404, "not_found", "Vista no encontrada");
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const updated = await prisma.databaseView.update({
    where: { id: params.viewId },
    data: parsed.data
  });
  return NextResponse.json(updated);
});

export const DELETE = withApi({ scope: "databases:write" }, async (_req, { params, api }) => {
  const view = await prisma.databaseView.findFirst({
    where: { id: params.viewId, database: { id: params.id, workspaceId: api.workspaceId } }
  });
  if (!view) throw new ApiError(404, "not_found", "Vista no encontrada");
  await prisma.databaseView.delete({ where: { id: params.viewId } });
  return NextResponse.json({ ok: true });
});
