export type InvoicePaymentState = {
  paidCents: number;
  status: "ISSUED" | "PAID";
  paidAt: Date | null;
};

export function derivePaymentState(
  totalCents: number,
  ledgerBalanceCents: number,
  lastPaymentAt = new Date()
): InvoicePaymentState {
  const paidCents = Math.min(Math.max(ledgerBalanceCents, 0), Math.max(totalCents, 0));
  const isPaid = totalCents > 0 && paidCents >= totalCents;

  return {
    paidCents,
    status: isPaid ? "PAID" : "ISSUED",
    paidAt: isPaid ? lastPaymentAt : null
  };
}

export function validatePaymentAmount(amountCents: number, outstandingCents: number): string | null {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return "El importe del cobro debe ser mayor que cero.";
  }
  if (amountCents > outstandingCents) {
    return "El importe no puede superar el saldo pendiente.";
  }
  return null;
}
