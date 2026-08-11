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

export type SepaJobCandidate = { invoiceId: string; amountCents: number; ibanMasked: string | null; chargeDate: Date | null };

function localDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function matchSepaReceipt(payment: { amountCents: number; debtorIbanLast4: string; bookedAt: Date }, jobs: SepaJobCandidate[]): PaymentMatch | null {
  const matches = jobs.filter((job) => {
    const last4 = (job.ibanMasked ?? "").replace(/\D/g, "").slice(-4);
    return job.amountCents === payment.amountCents && Boolean(last4) && last4 === payment.debtorIbanLast4
      && Boolean(job.chargeDate) && localDay(job.chargeDate!) === localDay(payment.bookedAt);
  });
  return matches.length === 1 ? { invoiceId: matches[0].invoiceId, confidence: "SEPA_RECEIPT" } : null;
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

  const counterparty = normalize(payment.counterpartyName);
  if (!counterparty) return null;
  const byClient = open.filter((invoice) => {
      const client = normalize(invoice.clientName);
      return client.length >= 4 && (counterparty.includes(client) || client.includes(counterparty));
    });
  return byClient.length === 1 ? { invoiceId: byClient[0].id, confidence: "CLIENT_AMOUNT" } : null;
}
