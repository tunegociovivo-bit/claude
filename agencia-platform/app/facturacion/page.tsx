import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import FacturacionClient from "@/components/FacturacionClient";
import { completeRixusIssuerProfile } from "@/lib/invoicing/rixus";
import { synchronizeInvoiceCounters } from "@/lib/invoicing/counter-sync";
import { repairLegacyInvoiceDocuments } from "@/lib/invoicing/legacy-repair";
import { listRecurringTemplates } from "@/lib/invoicing/holded-recurring-import";
import { upcomingRecurringDeliveries } from "@/lib/invoicing/recurring-presentation";

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

  const [clients, issuers, recurringTemplates] = await Promise.all([
    prisma.client.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true, taxId: true, email: true, billingEmail: true },
      orderBy: { name: "asc" }
    }),
    prisma.invoiceIssuer.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
    }),
    listRecurringTemplates(workspaceId)
  ]);
  const recImported = recurringTemplates.length;
  const recActive = recurringTemplates.filter((template) => template.status === "active").length;
  const recPaused = recImported - recActive;
  const upcomingRecurring = upcomingRecurringDeliveries(recurringTemplates, 3);

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
      <section className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600 text-lg">🔁</span>
            <div>
              <div className="font-semibold text-slate-800">Facturas recurrentes</div>
              <div className="text-sm text-slate-500">
                {recImported} configuradas · <span className="text-emerald-600 font-medium">{recActive} activas</span> · <span className="text-amber-600 font-medium">{recPaused} pausadas</span>
              </div>
            </div>
          </div>
          <a href="/admin/facturacion-recurrentes" className="text-sm text-brand-600 font-medium hover:underline">Gestionar →</a>
        </div>
        <div className="border-t border-slate-100">
          {upcomingRecurring.length ? upcomingRecurring.map((delivery) => (
            <div key={delivery.id} className="grid gap-1 border-b border-slate-100 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] md:items-center md:gap-5">
              <span className="truncate text-sm font-medium text-slate-700">{delivery.contactName || "Cliente sin nombre"}</span>
              <span className="text-sm text-slate-600"><span className="font-medium">{delivery.date}</span> · {delivery.sendAutomatically ? "envío automático" : "solo creación"}</span>
              <span className="min-w-0 text-xs text-slate-500 md:text-right"><span className="block break-all">Para: {delivery.recipient}</span>{delivery.bcc && <span className="block break-all">BCC: {delivery.bcc}</span>}</span>
            </div>
          )) : <div className="px-4 py-3 text-sm text-slate-500">No hay próximas facturas recurrentes activas.</div>}
        </div>
      </section>
      <FacturacionClient clients={clients} initialIssuers={issuers as any} />
    </div>
  );
}
