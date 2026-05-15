import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

const patchSchema = z.object({
  status: z.enum(["REPORTED", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DISMISSED"]).optional(),
  resolutionNote: z.string().max(2000).optional(),
  resolutionCommit: z.string().max(64).optional()
});

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const item = await prisma.errorReport.findUnique({ where: { id: params.id } });
  if (!item) throw new ApiError(404, "not_found", "Error report no encontrado");
  return NextResponse.json(item);
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const data: any = { ...parsed.data };
  if (data.status === "ACKNOWLEDGED" || data.status === "IN_PROGRESS") {
    data.acknowledgedAt = new Date();
  }
  if (data.status === "RESOLVED" || data.status === "DISMISSED") {
    data.resolvedAt = new Date();
  }
  const updated = await prisma.errorReport.update({ where: { id: params.id }, data });
  return NextResponse.json(updated);
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  await prisma.errorReport.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
