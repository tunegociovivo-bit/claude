import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const patchSchema = z.object({
  title: z.string().optional(),
  icon: z.string().optional(),
  category: z.string().optional(),
  parentId: z.string().nullable().optional(),
  content: z.any().optional(),
  archived: z.boolean().optional()
});

export const GET = withApi({ scope: "docs:read" }, async (_req, { params, api }) => {
  const doc = await prisma.document.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    include: { children: { select: { id: true, title: true, icon: true } } }
  });
  if (!doc) throw new ApiError(404, "not_found", "Documento no encontrado");
  return NextResponse.json(doc);
});

export const PATCH = withApi({ scope: "docs:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const updated = await prisma.document.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: parsed.data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Documento no encontrado");
  return NextResponse.json(await prisma.document.findUnique({ where: { id: params.id } }));
});

export const DELETE = withApi({ scope: "docs:write" }, async (_req, { params, api }) => {
  const updated = await prisma.document.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, archived: false },
    data: { archived: true }
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Documento no encontrado");
  return NextResponse.json({ ok: true });
});
