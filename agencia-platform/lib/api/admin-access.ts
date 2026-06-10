/**
 * Autorización de endpoints admin sensible al acceso GRANULAR del panel.
 *
 * Antes los endpoints de configuración exigían `role === "ADMIN"`. Con el
 * acceso granular (lib/admin-catalog.ts + Membership.adminGrants), un miembro
 * al que se le ha concedido una tarjeta/sección del panel debe poder USAR su
 * endpoint asociado (no solo verlo). Este helper centraliza ese chequeo:
 *
 *   - ADMIN → siempre.
 *   - Miembro con la tarjeta `cardHref` concedida (suelta o por su sección) → sí.
 *   - Resto → 403.
 *
 * Las tarjetas marcadas adminOnly nunca entran en el acceso efectivo de un
 * miembro, así que sus endpoints siguen siendo de facto solo-admin.
 */

import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/auth";
import { effectiveAdminAccess } from "@/lib/admin-catalog";

/**
 * Lanza 403 si el usuario no puede usar la tarjeta de panel indicada.
 * `cardHref` es el href de la tarjeta en lib/admin-catalog.ts
 * (p. ej. "/admin/integrations/google-sheets").
 */
export async function requireAdminCardAccess(
  workspaceId: string,
  userId: string | undefined,
  cardHref: string
): Promise<void> {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({
    where: { workspaceId, userId },
    select: { role: true, adminGrants: true }
  });
  if (!me) throw new ApiError(403, "forbidden", "Sin acceso al workspace");
  const access = effectiveAdminAccess(me.role, (me as any).adminGrants);
  if (access.all || access.hrefs.has(cardHref)) return;
  throw new ApiError(403, "forbidden", "No tienes acceso a esta sección del panel");
}
