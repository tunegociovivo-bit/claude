import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import DeliverablesClient from "@/components/admin/DeliverablesClient";

export const dynamic = "force-dynamic";

export default async function DeliverablesPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");
  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me) redirect("/");

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Entregables"
        description="Piezas (PDFs, mockups, vídeos…) que el cliente aprueba desde su portal. Diferente del calendario editorial."
      />
      <DeliverablesClient />
    </div>
  );
}
