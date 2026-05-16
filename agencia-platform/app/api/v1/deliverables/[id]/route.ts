import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { auditFromReq } from "@/lib/audit/log";

const patchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  fileId: z.string().nullable().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  dueAt: z.string().datetime().nullable().optional()
});

export const PATCH = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const updated = await prisma.deliverable.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: {
      ...parsed.data,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : parsed.data.dueAt
    } as any
  });
  if (updated.count === 0) throw new ApiError(404, "not_found");
  auditFromReq(req, api, {
    action: "deliverable.update",
    targetType: "DELIVERABLE",
    targetId: params.id,
    after: parsed.data
  });
  return NextResponse.json(await prisma.deliverable.findUnique({ where: { id: params.id } }));
});

export const DELETE = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  const del = await prisma.deliverable.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (del.count === 0) throw new ApiError(404, "not_found");
  auditFromReq(req, api, {
    action: "deliverable.delete",
    targetType: "DELIVERABLE",
    targetId: params.id
  });
  return NextResponse.json({ ok: true });
});
