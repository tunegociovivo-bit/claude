import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const patchSchema = z.object({
  title: z.string().optional(),
  values: z.record(z.string(), z.any()).optional()
});

export const PATCH = withApi({ scope: "databases:write" }, async (req, { params, api }) => {
  const record = await prisma.databaseRecord.findFirst({
    where: { id: params.recId, database: { id: params.id, workspaceId: api.workspaceId } }
  });
  if (!record) throw new ApiError(404, "not_found", "Registro no encontrado");

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  await prisma.$transaction(async (tx) => {
    if (parsed.data.title !== undefined) {
      await tx.databaseRecord.update({
        where: { id: params.recId },
        data: { title: parsed.data.title }
      });
    }
    if (parsed.data.values) {
      for (const [propertyId, value] of Object.entries(parsed.data.values)) {
        if (value === null || value === undefined) {
          await tx.databaseValue.deleteMany({
            where: { recordId: params.recId, propertyId }
          });
        } else {
          await tx.databaseValue.upsert({
            where: { recordId_propertyId: { recordId: params.recId, propertyId } },
            update: { value: value as any },
            create: { recordId: params.recId, propertyId, value: value as any }
          });
        }
      }
    }
  });

  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "databases:write" }, async (_req, { params, api }) => {
  const record = await prisma.databaseRecord.findFirst({
    where: { id: params.recId, database: { id: params.id, workspaceId: api.workspaceId } }
  });
  if (!record) throw new ApiError(404, "not_found", "Registro no encontrado");
  await prisma.databaseRecord.delete({ where: { id: params.recId } });
  return NextResponse.json({ ok: true });
});
