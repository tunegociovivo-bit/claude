import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { propertyCreateSchema } from "@/lib/api/db-schemas";

async function ensureOwned(id: string, workspaceId: string) {
  const exists = await prisma.database.count({ where: { id, workspaceId } });
  if (!exists) throw new ApiError(404, "not_found", "Database no encontrada");
}

export const GET = withApi({ scope: "databases:read" }, async (_req, { params, api }) => {
  await ensureOwned(params.id, api.workspaceId);
  const items = await prisma.databaseProperty.findMany({
    where: { databaseId: params.id },
    orderBy: { order: "asc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "databases:write" }, async (req, { params, api }) => {
  await ensureOwned(params.id, api.workspaceId);
  const body = await req.json().catch(() => null);
  const parsed = propertyCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const order =
    parsed.data.order ??
    ((await prisma.databaseProperty.count({ where: { databaseId: params.id } })) + 1);

  const prop = await prisma.databaseProperty.create({
    data: {
      databaseId: params.id,
      name: parsed.data.name,
      type: parsed.data.type,
      config: parsed.data.config ?? {},
      order
    }
  });
  return NextResponse.json(prop, { status: 201 });
});
