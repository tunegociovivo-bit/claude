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

// Un error report pertenece al workspace que lo generó (o a ninguno, si se
// reportó sin sesión). Un admin solo puede tocar los de SU workspace o los
// huérfanos — nunca los de otro workspace.
function ownScope(workspaceId: string) {
  return { OR: [{ workspaceId }, { workspaceId: null }] };
}

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const item = await prisma.errorReport.findFirst({
    where: { id: params.id, ...ownScope(api.workspaceId) }
  });
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
  const updated = await prisma.errorReport.updateMany({
    where: { id: params.id, ...ownScope(api.workspaceId) },
    data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Error report no encontrado");
  const item = await prisma.errorReport.findFirst({
    where: { id: params.id, ...ownScope(api.workspaceId) }
  });
  return NextResponse.json(item);
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const del = await prisma.errorReport.deleteMany({
    where: { id: params.id, ...ownScope(api.workspaceId) }
  });
  if (del.count === 0) throw new ApiError(404, "not_found", "Error report no encontrado");
  return NextResponse.json({ ok: true });
});
