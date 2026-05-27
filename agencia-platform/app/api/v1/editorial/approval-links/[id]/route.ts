/**
 * DELETE /api/v1/editorial/approval-links/[id]
 * Revoca un link (soft delete: pone revokedAt = now).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const updated = await prisma.clientApprovalLink.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Link no encontrado");
  return NextResponse.json({ ok: true });
});
