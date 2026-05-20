/**
 * GET /api/v1/admin/secrets
 *
 * Lista TODAS las credenciales/tokens del workspace ENMASCARADAS
 * (•••1234). Solo admins. El valor en claro NO se devuelve aquí —
 * para eso está POST /secrets/reveal con re-autenticación.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { listSecrets } from "@/lib/admin/secrets-vault";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId }
  });
  if (!me || me.role !== "ADMIN") {
    throw new ApiError(403, "forbidden", "Solo admins");
  }
  const secrets = await listSecrets(api.workspaceId);
  // Agrupar por categoría para la UI
  const byCategory: Record<string, typeof secrets> = {};
  for (const s of secrets) {
    (byCategory[s.category] ??= []).push(s);
  }
  return NextResponse.json({ count: secrets.length, byCategory });
});
