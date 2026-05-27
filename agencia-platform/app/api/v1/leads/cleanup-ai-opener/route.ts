/**
 * POST /api/v1/leads/cleanup-ai-opener
 *
 * Borra el campo aiOpener (y aiOpenerGeneratedAt) de TODOS los leads del
 * workspace. Útil para purgar los openers heredados del plugin WordPress
 * que mostraban datos obsoletos en los mensajes ("posición 24" cuando la
 * nueva búsqueda dice 13). Después de purgar, los placeholders
 * {{opener_ia}} salen vacíos y el resto del mensaje sigue siendo correcto.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
  const out = await prisma.lead.updateMany({
    where: { workspaceId: api.workspaceId, aiOpener: { not: null } },
    data: { aiOpener: null, aiOpenerGeneratedAt: null }
  });
  return NextResponse.json({ updated: out.count });
});
