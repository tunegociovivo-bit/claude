/**
 * Rentabilidad por cliente basada SOLO en datos trazables (FASE 3).
 *
 * PRINCIPIO: nunca inventar costes. En este modelo:
 *   - INGRESOS son trazables: Invoice.clientId + importes en céntimos + estado.
 *   - MRR recurrente (Client.mrr) es un dato aparte (mensual), NO se mezcla con
 *     lo facturado puntual.
 *   - COSTES por cliente NO son trazables: Expense va por `issuerId` (empresa),
 *     no por cliente/proyecto, y NO existe registro de horas. → coste "sin datos".
 *   - MARGEN por tanto NO es calculable → "sin datos" explícito (no se inventa).
 *
 * Todo en céntimos salvo `mrrEuros` (Client.mrr se guarda como euros enteros).
 */

// Estados de factura que cuentan como facturado (emitido). DRAFT y CANCELLED no.
export const BILLED_INVOICE_STATUSES = new Set(["ISSUED", "PAID"]);

export type InvoiceForProfit = {
  status: string;
  totalCents: number;
  paidCents: number;
  dueDate: Date | null;
};

export type Profitability = {
  recurring: { mrrEuros: number; hasMrr: boolean };
  invoiced: {
    count: number;
    billedCents: number;
    paidCents: number;
    pendingCents: number;
    overdueCents: number;
    overdueCount: number;
  };
  cost: { available: false; reason: string };
  margin: { available: false; reason: string };
  dataQuality: {
    hasInvoices: boolean;
    hasMrr: boolean;
    costsTraceable: false;
    notes: string[];
  };
};

const COST_REASON =
  "Sin datos: no hay costes imputables por cliente (los gastos se registran por empresa emisora, no por cliente, y no existe registro de horas).";
const MARGIN_REASON = "Sin datos: el margen no es calculable sin costes trazables por cliente.";

export function computeProfitability(input: { mrrEuros: number; invoices: InvoiceForProfit[]; now: Date }): Profitability {
  const { mrrEuros, invoices, now } = input;
  const billed = invoices.filter((i) => BILLED_INVOICE_STATUSES.has(i.status));

  let billedCents = 0;
  let paidCents = 0;
  let overdueCents = 0;
  let overdueCount = 0;

  for (const inv of billed) {
    // Math.trunc (no `| 0`): `| 0` es coerción a int32 y desbordaría importes
    // > ~21,5M € haciéndolos negativos → clamp a 0 → factura perdida en silencio.
    const total = Math.max(0, Math.trunc(inv.totalCents) || 0);
    const paid = Math.max(0, Math.min(Math.trunc(inv.paidCents) || 0, total));
    billedCents += total;
    paidCents += paid;
    const outstanding = total - paid;
    if (outstanding > 0 && inv.dueDate && inv.dueDate.getTime() < now.getTime()) {
      overdueCents += outstanding;
      overdueCount += 1;
    }
  }
  const pendingCents = Math.max(0, billedCents - paidCents);

  // hasInvoices se basa en facturas EMITIDAS (billed), no en la lista sin filtrar:
  // un cliente con solo borradores/presupuestos no tiene facturación real.
  const hasInvoices = billed.length > 0;
  const hasMrr = mrrEuros > 0;
  const notes: string[] = [];
  if (!hasInvoices) notes.push("Este cliente no tiene facturas emitidas registradas.");
  if (!hasMrr) notes.push("Sin MRR configurado para el cliente.");
  notes.push("Costes por cliente no disponibles en el modelo actual (ver rentabilidad al 100% requeriría imputar gastos/horas).");

  return {
    recurring: { mrrEuros: Math.max(0, Math.trunc(mrrEuros) || 0), hasMrr },
    invoiced: { count: billed.length, billedCents, paidCents, pendingCents, overdueCents, overdueCount },
    cost: { available: false, reason: COST_REASON },
    margin: { available: false, reason: MARGIN_REASON },
    dataQuality: { hasInvoices, hasMrr, costsTraceable: false, notes }
  };
}
