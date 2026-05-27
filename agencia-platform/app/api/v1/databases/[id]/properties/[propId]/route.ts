import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { propertyUpdateSchema } from "@/lib/api/db-schemas";

export const PATCH = withApi({ scope: "databases:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = propertyUpdateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const prop = await prisma.databaseProperty.findFirst({
    where: { id: params.propId, database: { workspaceId: api.workspaceId, id: params.id } }
  });
  if (!prop) throw new ApiError(404, "not_found", "Propiedad no encontrada");

  const updated = await prisma.databaseProperty.update({
    where: { id: params.propId },
    data: parsed.data as any
  });
  return NextResponse.json(updated);
});

export const DELETE = withApi({ scope: "databases:write" }, async (_req, { params, api }) => {
  const prop = await prisma.databaseProperty.findFirst({
    where: { id: params.propId, database: { workspaceId: api.workspaceId, id: params.id } }
  });
  if (!prop) throw new ApiError(404, "not_found", "Propiedad no encontrada");
  await prisma.databaseProperty.delete({ where: { id: params.propId } });
  return NextResponse.json({ ok: true });
});
