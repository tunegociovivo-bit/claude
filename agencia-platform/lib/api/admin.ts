import { prisma } from "@/lib/db/prisma";
import { ApiError, type ApiContext } from "./auth";

/**
 * Exige que el llamante sea ADMIN del workspace. Para endpoints que solo
 * deben usar los administradores (p.ej. el gestor de facturas).
 */
export async function requireAdmin(api: ApiContext): Promise<void> {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const m = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId }
  });
  if (!m || m.role !== "ADMIN") {
    throw new ApiError(403, "forbidden", "Solo los administradores pueden acceder a esto");
  }
}
