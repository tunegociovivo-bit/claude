import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import FacturacionClient from "@/components/FacturacionClient";

export const dynamic = "force-dynamic";

export default async function FacturacionPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  const [clients, issuers] = await Promise.all([
    prisma.client.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true, taxId: true },
      orderBy: { name: "asc" }
    }),
    prisma.invoiceIssuer.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
    })
  ]);

  return (
    <div className="max-w-6xl mx-auto pb-24">
      <PageHeader
        title="Facturación"
        description="Elige primero la empresa con la que vas a facturar. Después emite facturas, presupuestos, rectificativas y proformas — recurrentes, multi-divisa, Stripe y Factura-e."
      />
      <div className="mb-3">
        <a href="/facturacion/remesas" className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100">
          🏦 Remesas de adeudos SEPA
        </a>
      </div>
      <FacturacionClient clients={clients} initialIssuers={issuers as any} />
    </div>
  );
}
