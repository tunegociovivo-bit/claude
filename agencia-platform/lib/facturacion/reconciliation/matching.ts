export type ReconciliationInvoice = {
  id: string;
  number: string | null;
  clientName: string;
  totalCents: number;
  paidCents: number;
  issueDate: Date;
};

export type IncomingPayment = {
  amountCents: number;
  reference: string;
  counterpartyName: string;
};

export type PaymentMatch = {
  invoiceId: string;
  confidence: "EXACT_REFERENCE" | "CLIENT_AMOUNT" | "SEPA_RECEIPT";
};

export type SepaJobCandidate = {
  invoiceId: string;
  amountCents: number;
  ibanMasked: string | null;
  chargeDate: Date | null;
  clientName?: string | null;
  mandateRef?: string | null;
};

export function retainEligiblePaymentMatch<T extends PaymentMatch>(match: T | null, eligibleInvoiceIds: Iterable<string>): T | null {
  if (!match) return null;
  return new Set(eligibleInvoiceIds).has(match.invoiceId) ? match : null;
}
export type SepaRequestCandidate = { invoiceId: string; amountCents: number; chargeDate: Date | null; archivedAt?: Date | null; outstanding?: boolean };

export function effectiveSepaCandidateDate(chargeDate: Date | null, createdAt: Date): Date {
  return chargeDate ?? createdAt;
}

function localDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function matchSepaReceipt(payment: { amountCents: number; debtorIbanLast4: string; debtorName?: string | null; bookedAt: Date }, jobs: SepaJobCandidate[]): PaymentMatch | null {
  const earliestCharge = payment.bookedAt.getTime() - 4 * 24 * 60 * 60 * 1000;
  const latestCharge = payment.bookedAt.getTime();
  const matches = jobs.filter((job) => {
    const last4 = (job.ibanMasked ?? "").replace(/\D/g, "").slice(-4);
    const bankDebtor = normalize(payment.debtorName ?? "");
    const knownNames = [job.mandateRef, job.clientName].map((value) => normalize(value ?? "")).filter((value) => value.length >= 4);
    const identityMatches = last4
      ? last4 === payment.debtorIbanLast4
      : Boolean(bankDebtor) && knownNames.some((name) => bankDebtor.includes(name) || name.includes(bankDebtor));
    return job.amountCents === payment.amountCents && identityMatches
      && Boolean(job.chargeDate)
      && job.chargeDate!.getTime() >= earliestCharge
      && job.chargeDate!.getTime() <= latestCharge;
  });
  const invoiceIds = [...new Set(matches.map((job) => job.invoiceId))];
  return invoiceIds.length === 1 ? { invoiceId: invoiceIds[0], confidence: "SEPA_RECEIPT" } : null;
}

export function shouldReprocessExistingBankTransaction(status: string, hasVerifiedReceiptIdentifiers: boolean): boolean {
  return status === "UNMATCHED" && hasVerifiedReceiptIdentifiers;
}

export function requiresVerifiedSepaReceipt(reference: string | null | undefined, remittanceNumber?: string | null): boolean {
  return Boolean(remittanceNumber) || /emision\s+remesa\s+sepa|remesa\s+sepa/i.test(reference ?? "");
}

export function persistedBankReference(reference: string | null | undefined, remittanceNumber?: string | null): string {
  const cleanReference = (reference ?? "").trim();
  if (!remittanceNumber || requiresVerifiedSepaReceipt(cleanReference)) return cleanReference;
  return `Remesa SEPA ${remittanceNumber} · ${cleanReference}`;
}

export function matchUniqueSepaSummary(payment: { amountCents: number; bookedAt: Date }, requests: SepaRequestCandidate[]): PaymentMatch | null {
  // A bank summary does not identify the debtor. Amount and settlement date,
  // even when apparently unique, are insufficient proof for reconciliation.
  void payment;
  void requests;
  return null;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function shouldImportMovement(movement: { bookedAt: Date; amountCents: number }, startsAt: Date): boolean {
  return movement.amountCents !== 0 && movement.bookedAt.getTime() >= startsAt.getTime();
}

export function matchIncomingPayment(payment: IncomingPayment, invoices: ReconciliationInvoice[]): PaymentMatch | null {
  const open = invoices.filter((invoice) => invoice.totalCents - invoice.paidCents === payment.amountCents);
  const reference = normalize(payment.reference);
  const exact = open.filter((invoice) => invoice.number && reference.includes(normalize(invoice.number)));
  if (exact.length === 1) return { invoiceId: exact[0].id, confidence: "EXACT_REFERENCE" };
  // Si el banco aporta un número de factura, nunca degradamos a cliente+importe:
  // una referencia desconocida debe revisarse, no pagar otra factura del cliente.
  if (/\bfac\s*\d+/i.test(reference)) return null;

  const counterparty = normalize(payment.counterpartyName);
  if (!counterparty) return null;
  const byClient = open.filter((invoice) => {
      const client = normalize(invoice.clientName);
      return client.length >= 4 && (counterparty.includes(client) || client.includes(counterparty));
    });
  return byClient.length === 1 ? { invoiceId: byClient[0].id, confidence: "CLIENT_AMOUNT" } : null;
}
