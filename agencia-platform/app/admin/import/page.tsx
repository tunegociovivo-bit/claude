import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import ImporterClient from "@/components/admin/ImporterClient";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  return (
    <div className="max-w-5xl mx-auto pb-24">
      <PageHeader
        title="Importador (clientes y facturas)"
        description="Sube un listado en PDF, CSV o Excel. Si un cliente ya existe, solo se rellenan los datos que le falten — nunca se sobrescribe. Solo administradores."
      />
      <ImporterClient />
    </div>
  );
}
