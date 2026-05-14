import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { databaseCreateSchema } from "@/lib/api/db-schemas";

export const GET = withApi({ scope: "databases:read" }, async (_req, { api }) => {
  const items = await prisma.database.findMany({
    where: { workspaceId: api.workspaceId },
    include: {
      _count: { select: { records: true, properties: true, views: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "databases:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = databaseCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const db = await prisma.$transaction(async (tx) => {
    const created = await tx.database.create({
      data: { ...parsed.data, workspaceId: api.workspaceId }
    });
    // Propiedad por defecto + vista por defecto
    await tx.databaseProperty.create({
      data: {
        databaseId: created.id,
        name: "Estado",
        type: "SELECT",
        config: { options: [
          { label: "Por hacer", color: "bg-slate-200" },
          { label: "En curso", color: "bg-indigo-200" },
          { label: "Hecho", color: "bg-emerald-200" }
        ] },
        order: 0
      }
    });
    await tx.databaseView.create({
      data: { databaseId: created.id, name: "Tabla", type: "TABLE", config: {}, order: 0 }
    });
    return created;
  });
  return NextResponse.json(db, { status: 201 });
});
