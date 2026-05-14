import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { clientCreateSchema } from "@/lib/api/schemas";

export const GET = withApi({ scope: "clients:read" }, async (_req, { params, api }) => {
  const client = await prisma.client.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    include: { projects: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");
  return NextResponse.json(client);
});

export const PATCH = withApi({ scope: "clients:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = clientCreateSchema.partial().safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const updated = await prisma.client.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: parsed.data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");
  return NextResponse.json(await prisma.client.findUnique({ where: { id: params.id } }));
});

export const DELETE = withApi({ scope: "clients:write" }, async (_req, { params, api }) => {
  const updated = await prisma.client.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    data: { deletedAt: new Date() }
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");
  return NextResponse.json({ ok: true });
});
