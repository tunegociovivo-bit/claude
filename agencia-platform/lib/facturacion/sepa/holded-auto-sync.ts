import { prisma } from "@/lib/db/prisma";
import { holdedInvoicesAsInputs } from "@/lib/import/holded-sync";
import { applyInvoiceImport, type InvoiceInput } from "@/lib/import/invoices";
import { NEGOCIO_VIVO_ISSUER_NAME } from "./candidates";

export function isApprovedNormalHoldedInvoice(input: InvoiceInput): boolean {
  const number = input.number?.trim() ?? "";
  return input.status === "ISSUED" && number.length > 0 && !/^R-/i.test(number);
}

/**
 * Sincroniza las facturas aprobadas de Holded con el HUB antes de buscar
 * candidatas SEPA. El importador ya es idempotente por número de factura.
 */
export async function syncApprovedHoldedInvoices(workspaceId: string): Promise<{
  fetched: number;
  eligible: number;
  created: number;
  skipped: number;
  configured: boolean;
}> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const holded = (workspace?.settings as any)?.integrations?.holded;
  if (!holded?.apiKey) {
    return { fetched: 0, eligible: 0, created: 0, skipped: 0, configured: false };
  }

  const issuer = await prisma.invoiceIssuer.findFirst({
    where: { workspaceId, deletedAt: null, name: NEGOCIO_VIVO_ISSUER_NAME },
    select: { id: true }
  });
  if (!issuer) throw new Error(`No existe la emisora ${NEGOCIO_VIVO_ISSUER_NAME}`);

  // Ventana solapada: tolera caídas temporales del cron y los duplicados quedan
  // absorbidos por el importador. Evita descargar todo el histórico cada 5 min.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const inputs = await holdedInvoicesAsInputs(workspaceId, {
    startTimestamp: nowSeconds - 7 * 24 * 60 * 60,
    endTimestamp: nowSeconds + 24 * 60 * 60
  });
  const eligible = inputs.filter(isApprovedNormalHoldedInvoice);
  const result = await applyInvoiceImport(workspaceId, eligible, issuer.id);
  return {
    fetched: inputs.length,
    eligible: eligible.length,
    ...result,
    configured: true
  };
}
