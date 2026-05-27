import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { viewCreateSchema } from "@/lib/api/db-schemas";

export const POST = withApi({ scope: "databases:write" }, async (req, { params, api }) => {
  const db = await prisma.database.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!db) throw new ApiError(404, "not_found", "Database no encontrada");
  const body = await req.json().catch(() => null);
  const parsed = viewCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const order =
    parsed.data.order ??
    ((await prisma.databaseView.count({ where: { databaseId: params.id } })) + 1);

  const view = await prisma.databaseView.create({
    data: {
      databaseId: params.id,
      name: parsed.data.name,
      type: parsed.data.type,
      config: parsed.data.config ?? {},
      order
    }
  });
  return NextResponse.json(view, { status: 201 });
});
