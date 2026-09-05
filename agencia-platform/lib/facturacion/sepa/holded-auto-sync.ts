import { prisma } from "@/lib/db/prisma";
import { holdedInvoicesAsInputs } from "@/lib/import/holded-sync";
import { applyInvoiceImport, type InvoiceInput } from "@/lib/import/invoices";
import { NEGOCIO_VIVO_ISSUER_NAME } from "./candidates";

export function isApprovedNormalHoldedInvoice(input: InvoiceInput): boolean {
  const number = input.number?.trim() ?? "";
  return input.status === "ISSUED" && number.length > 0 && !/^R-/i.test(number);
}

export function invoiceSequence(number: string | undefined): number | null {
  const match = number?.trim().match(/^FAC-(\d+)$/i);
  return match ? Number(match[1]) : null;
}

export function rectifyingSequence(number: string | undefined): number | null {
  const match = number?.trim().match(/^R-(\d+)$/i);
  return match ? Number(match[1]) : null;
}

/**
 * Sincroniza las facturas aprobadas de Holded con el HUB antes de buscar
 * candidatas SEPA. El importador ya es idempotente por número de factura.
 */
export async function syncApprovedHoldedInvoices(workspaceId: string, signal?: AbortSignal): Promise<{
  fetched: number;
  eligible: number;
  created: number;
  skipped: number;
  configured: boolean;
  createdInvoiceIds: string[];
}> {
  signal?.throwIfAborted();
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const holded = (workspace?.settings as any)?.integrations?.holded;
  if (!holded?.apiKey) {
    return { fetched: 0, eligible: 0, created: 0, skipped: 0, configured: false, createdInvoiceIds: [] };
  }

  const issuer = await prisma.invoiceIssuer.findFirst({
    where: { workspaceId, deletedAt: null, name: NEGOCIO_VIVO_ISSUER_NAME },
    select: { id: true }
  });
  if (!issuer) throw new Error(`No existe la emisora ${NEGOCIO_VIVO_ISSUER_NAME}`);

  // Ventana solapada: tolera caídas temporales del cron y los duplicados quedan
  // absorbidos por el importador. Evita descargar todo el histórico cada 5 min.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const [datedInputs, latestInputs] = await Promise.all([
    holdedInvoicesAsInputs(workspaceId, {
      startTimestamp: nowSeconds - 7 * 24 * 60 * 60,
      endTimestamp: nowSeconds + 24 * 60 * 60,
      signal
    }),
    // La fecha fiscal puede ser distinta del día en que Holded crea el
    // documento. La lista ordenada por creación evita perder esas facturas.
    holdedInvoicesAsInputs(workspaceId, { limit: 100, signal })
  ]);
  signal?.throwIfAborted();
  const byNumber = new Map<string, InvoiceInput>();
  for (const input of [...datedInputs, ...latestInputs]) {
    const key = input.number?.trim().toLowerCase();
    if (!key) continue;
    const previous = byNumber.get(key);
    if (!previous || (!previous.clientName && input.clientName)) byNumber.set(key, input);
  }
  const inputs = [...byNumber.values()];
  const existingNumbers = await prisma.invoice.findMany({
    where: { workspaceId, issuerId: issuer.id, number: { not: null }, deletedAt: null },
    select: { number: true }
  });
  const existingSet = new Set(existingNumbers.map((row) => row.number!.toLowerCase()));
  const highestSequence = existingNumbers.reduce((max, row) => Math.max(max, invoiceSequence(row.number ?? undefined) ?? 0), 0);
  const highestRectifyingSequence = existingNumbers.reduce(
    (max, row) => Math.max(max, rectifyingSequence(row.number ?? undefined) ?? 0),
    0
  );
  const eligible = inputs.filter((input) => {
    const number = input.number?.trim();
    if (input.status !== "ISSUED" || !number) return false;
    const key = input.number!.trim().toLowerCase();
    // Los documentos existentes se conservan para reparar nombres. Un
    // documento ausente solo se importa si avanza la secuencia fiscal; así un
    // listado sin fecha nunca reabre huecos históricos.
    return existingSet.has(key)
      || (invoiceSequence(input.number) ?? 0) > highestSequence
      || (rectifyingSequence(input.number) ?? 0) > highestRectifyingSequence;
  });
  const startedAt = new Date();
  signal?.throwIfAborted();
  const result = await applyInvoiceImport(workspaceId, eligible, issuer.id);
  const numbers = eligible.map((item) => item.number!).filter(Boolean);
  const createdRows = numbers.length
    ? await prisma.invoice.findMany({
        where: { workspaceId, issuerId: issuer.id, number: { in: numbers }, createdAt: { gte: startedAt } },
        select: { id: true, number: true, type: true }
      })
    : [];
  return {
    fetched: inputs.length,
    eligible: eligible.length,
    ...result,
    configured: true,
    createdInvoiceIds: createdRows
      .filter((row) => row.type === "NORMAL" && !/^R-/i.test(row.number ?? ""))
      .map((row) => row.id)
  };
}
