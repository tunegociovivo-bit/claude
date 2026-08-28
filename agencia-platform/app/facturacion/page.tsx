import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import FacturacionClient from "@/components/FacturacionClient";
import { completeRixusIssuerProfile } from "@/lib/invoicing/rixus";
import { synchronizeInvoiceCounters } from "@/lib/invoicing/counter-sync";
import { repairLegacyInvoiceDocuments } from "@/lib/invoicing/legacy-repair";

export const dynamic = "force-dynamic";

export default async function FacturacionPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  await completeRixusIssuerProfile(workspaceId);
  await synchronizeInvoiceCounters(workspaceId);
  await repairLegacyInvoiceDocuments(workspaceId, userId);

  const [clients, issuers, recImported, recActive] = await Promise.all([
    prisma.client.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true, taxId: true, email: true, billingEmail: true },
      orderBy: { name: "asc" }
    }),
    prisma.invoiceIssuer.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
    }),
    // Resumen REAL de recurrencias (sin hardcode): importadas de Holded y cuántas activas.
    prisma.invoice.count({ where: { workspaceId, deletedAt: null, holdedRecurringId: { not: null } } }),
    prisma.invoice.count({ where: { workspaceId, deletedAt: null, holdedRecurringId: { not: null }, recurring: true } })
  ]);
  const recPaused = recImported - recActive;

  return (
    <div className="max-w-6xl mx-auto pb-24">
      <PageHeader
        title="Facturación"
        description="Elige primero la empresa con la que vas a facturar. Después emite facturas, presupuestos, rectificativas y proformas — recurrentes, multi-divisa, Stripe y Factura-e."
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <a href="/facturacion/remesas" className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100">
          🏦 Remesas de adeudos SEPA
        </a>
      </div>
      <a
        href="/admin/facturacion-recurrentes"
        className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm transition"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600 text-lg">🔁</span>
          <div>
            <div className="font-semibold text-slate-800">Facturas recurrentes</div>
            <div className="text-sm text-slate-500">
              {recImported} importadas · <span className="text-emerald-600 font-medium">{recActive} activas</span> · <span className="text-amber-600 font-medium">{recPaused} pausadas</span>
            </div>
          </div>
        </div>
        <span className="text-sm text-brand-600 font-medium">Gestionar →</span>
      </a>
      <FacturacionClient clients={clients} initialIssuers={issuers as any} />
    </div>
  );
}
