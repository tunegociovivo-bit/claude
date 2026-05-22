import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import MetaGuardBadge from "@/components/admin/MetaGuardBadge";
import AdminConsole from "@/components/admin/AdminConsole";
import { prisma } from "@/lib/db/prisma";
import { getSessionWorkspaceId } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Sólo admins pueden ver este panel. Si no hay sesión, el middleware ya
  // redirige a /login. Aquí gateamos a no-admins mandándolos a /.
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Administración"
        description="Configuración de la plataforma e integraciones. Solo visible para administradores."
      />
      <MetaGuardBadge />
      <AdminConsole />
    </div>
  );
}
