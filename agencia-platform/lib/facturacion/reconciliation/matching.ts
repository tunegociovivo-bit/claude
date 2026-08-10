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
  confidence: "EXACT_REFERENCE" | "CLIENT_AMOUNT";
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function shouldImportMovement(movement: { bookedAt: Date; amountCents: number }, startsAt: Date): boolean {
  return movement.amountCents > 0 && movement.bookedAt.getTime() >= startsAt.getTime();
}

export function matchIncomingPayment(payment: IncomingPayment, invoices: ReconciliationInvoice[]): PaymentMatch | null {
  const open = invoices.filter((invoice) => invoice.totalCents - invoice.paidCents === payment.amountCents);
  const reference = normalize(payment.reference);
  const exact = open.filter((invoice) => invoice.number && reference.includes(normalize(invoice.number)));
  if (exact.length === 1) return { invoiceId: exact[0].id, confidence: "EXACT_REFERENCE" };

  const counterparty = normalize(payment.counterpartyName);
  if (!counterparty) return null;
  const byClient = open
    .filter((invoice) => {
      const client = normalize(invoice.clientName);
      return client.length >= 4 && (counterparty.includes(client) || client.includes(counterparty));
    })
    .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime());
  return byClient.length ? { invoiceId: byClient[0].id, confidence: "CLIENT_AMOUNT" } : null;
}
