import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { clientCreateSchema } from "@/lib/api/schemas";
import { callerIsAdmin, redactMrr } from "@/lib/api/permissions";

export const GET = withApi({ scope: "clients:read" }, async (_req, { params, api }) => {
  const [client, isAdmin] = await Promise.all([
    prisma.client.findFirst({
      where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
      include: { projects: true }
    }),
    callerIsAdmin(api)
  ]);
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");
  return NextResponse.json(redactMrr(client as any, isAdmin));
});

export const PATCH = withApi({ scope: "clients:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = clientCreateSchema.partial().safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Si no es admin, descartamos mrr del payload — un MEMBER no debe
  // poder modificarlo aunque la UI antigua lo mande.
  const isAdmin = await callerIsAdmin(api);
  const data: any = { ...parsed.data };
  if (!isAdmin) delete data.mrr;

  const updated = await prisma.client.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");
  const fresh = await prisma.client.findUnique({ where: { id: params.id } });
  return NextResponse.json(redactMrr(fresh as any, isAdmin));
});

export const DELETE = withApi({ scope: "clients:write" }, async (_req, { params, api }) => {
  const updated = await prisma.client.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    data: { deletedAt: new Date() }
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");
  return NextResponse.json({ ok: true });
});
