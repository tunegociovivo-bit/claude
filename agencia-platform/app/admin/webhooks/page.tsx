import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import WebhooksClient from "@/components/admin/WebhooksClient";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");
  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Webhooks salientes"
        description="Recibe en una URL un POST cuando algo cambia en el workspace. Conecta con Make, Zapier, n8n o un endpoint propio."
      />
      <WebhooksClient />
    </div>
  );
}
