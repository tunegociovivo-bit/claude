import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  effectiveAdminAccess,
  hasAnyAdminAccess,
  canAccessAdminPath
} from "@/lib/admin-catalog";

export const dynamic = "force-dynamic";

/**
 * Puerta única del panel de administración. Antes cada página comprobaba
 * `role === "ADMIN"` por su cuenta (de forma inconsistente). Ahora este layout
 * gobierna TODAS las rutas /admin/* en un único sitio:
 *
 *  - Sin sesión → /login.
 *  - Sin ningún acceso admin (ni ADMIN ni grants) → /.
 *  - Con acceso pero a una tarjeta que NO tiene concedida → rebota a /admin
 *    (la consola le muestra solo lo que sí puede abrir).
 *
 * El pathname llega vía la cabecera `x-pathname` que pone el middleware.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const me = await prisma.membership.findFirst({
    where: { userId, workspaceId },
    select: { role: true, adminGrants: true }
  });
  if (!me) redirect("/");

  const access = effectiveAdminAccess(me.role, (me as any).adminGrants);
  if (!hasAnyAdminAccess(access)) redirect("/");

  // Si por lo que sea no llega el header (no debería: el middleware lo pone en
  // todas las rutas), default-deny para no-admins (cadena vacía no casa con
  // ninguna tarjeta). Los ADMIN pasan siempre (access.all).
  const pathname = headers().get("x-pathname") ?? "";
  if (!canAccessAdminPath(access, pathname)) redirect("/admin");

  return <>{children}</>;
}
