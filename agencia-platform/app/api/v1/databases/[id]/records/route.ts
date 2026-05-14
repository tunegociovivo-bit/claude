import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { recordCreateSchema } from "@/lib/api/db-schemas";

async function ensureOwned(id: string, workspaceId: string) {
  const exists = await prisma.database.count({ where: { id, workspaceId } });
  if (!exists) throw new ApiError(404, "not_found", "Database no encontrada");
}

export const GET = withApi({ scope: "databases:read" }, async (_req, { params, api }) => {
  await ensureOwned(params.id, api.workspaceId);
  const records = await prisma.databaseRecord.findMany({
    where: { databaseId: params.id },
    include: { values: true },
    orderBy: { createdAt: "asc" }
  });
  // shape como { id, title, values: { [propertyId]: value } }
  const items = records.map((r) => {
    const map: Record<string, any> = {};
    for (const v of r.values) map[v.propertyId] = (v.value as any);
    return { id: r.id, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, values: map };
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "databases:write" }, async (req, { params, api }) => {
  await ensureOwned(params.id, api.workspaceId);
  const body = await req.json().catch(() => null);
  const parsed = recordCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const record = await prisma.$transaction(async (tx) => {
    const r = await tx.databaseRecord.create({
      data: { databaseId: params.id, title: parsed.data.title }
    });
    if (parsed.data.values) {
      for (const [propertyId, value] of Object.entries(parsed.data.values)) {
        await tx.databaseValue.create({
          data: { recordId: r.id, propertyId, value: value as any }
        });
      }
    }
    return r;
  });
  return NextResponse.json(record, { status: 201 });
});
