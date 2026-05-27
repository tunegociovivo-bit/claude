import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import HoldedSettingsClient from "@/components/admin/HoldedSettingsClient";

export const dynamic = "force-dynamic";

export default async function HoldedIntegrationPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  return (
    <div className="max-w-2xl mx-auto pb-24">
      <PageHeader
        title="Holded (contabilidad)"
        description="Conecta tu cuenta de Holded con su API key para descargar y gestionar facturas y contactos. Solo administradores."
      />
      <HoldedSettingsClient />
    </div>
  );
}
