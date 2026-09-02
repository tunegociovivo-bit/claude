import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import AccountancyInvoicesClient from "@/components/AccountancyInvoicesClient";
import { ensureDefaultAccountancyClients } from "@/lib/accountancy-invoices/service";

export const dynamic = "force-dynamic";

export default async function AccountancyInvoicesPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");
  const member = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!member || member.role !== "ADMIN") redirect("/facturacion");
  await ensureDefaultAccountancyClients(workspaceId);
  return <div className="mx-auto max-w-7xl pb-24"><PageHeader title="Facturas gestoría" description="Descarga, controla y envía cada mes las facturas de todos los clientes y plataformas." /><AccountancyInvoicesClient /></div>;
}
