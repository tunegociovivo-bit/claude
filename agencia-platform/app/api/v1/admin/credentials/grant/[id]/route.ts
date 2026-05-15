/**
 * DELETE /api/v1/admin/credentials/grant/[id]
 * Revoca un grant (soft: pone revokedAt). Útil si te has equivocado.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const updated = await prisma.credentialAccessGrant.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Grant no encontrado o ya revocado");
  return NextResponse.json({ ok: true });
});
