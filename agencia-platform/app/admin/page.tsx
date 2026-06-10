import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import MetaGuardBadge from "@/components/admin/MetaGuardBadge";
import AdminConsole from "@/components/admin/AdminConsole";
import { prisma } from "@/lib/db/prisma";
import { getSessionWorkspaceId } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { effectiveAdminAccess, hasAnyAdminAccess } from "@/lib/admin-catalog";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // El layout (app/admin/layout.tsx) ya garantiza sesión + algún acceso al
  // panel. Aquí calculamos qué tarjetas puede ver este usuario para mostrar
  // solo esas en la consola. Los ADMIN ven todo (accessibleHrefs = null).
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
  const isAdmin = me.role === "ADMIN";
  const accessibleHrefs = access.all ? null : Array.from(access.hrefs);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Administración"
        description={
          isAdmin
            ? "Configuración de la plataforma e integraciones. Solo visible para administradores."
            : "Las secciones de administración a las que tu administrador te ha dado acceso."
        }
      />
      {isAdmin && <MetaGuardBadge />}
      <AdminConsole accessibleHrefs={accessibleHrefs} />
    </div>
  );
}
