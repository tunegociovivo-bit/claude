import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import PapeleraClient from "@/components/admin/PapeleraClient";

export const dynamic = "force-dynamic";

export default async function PapeleraPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");
  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Papelera"
        description="Lo que se borra queda aquí 30 días antes de irse para siempre. Restáuralo o púrgalo manualmente."
      />
      <PapeleraClient />
    </div>
  );
}
