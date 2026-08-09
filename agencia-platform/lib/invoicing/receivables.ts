export type ReceivableInvoice = {
  status: string;
  type: string;
  totalCents: number;
  paidCents: number;
  issueDate: Date | string;
  dueDate: Date | string | null;
};

export type ReceivablesSummary = {
  issuedCents: number;
  collectedCents: number;
  outstandingCents: number;
  overdueCents: number;
  dueSoonCents: number;
  draftCents: number;
  documentCount: number;
  overdueCount: number;
  dueSoonCount: number;
};

const BILLABLE_TYPES = new Set(["NORMAL", "RECTIFICATIVA"]);

function dateOnly(value: Date | string): Date {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function buildReceivablesSummary(
  invoices: ReceivableInvoice[],
  now: Date = new Date(),
  dueSoonDays = 7
): ReceivablesSummary {
  const today = dateOnly(now);
  const dueSoonLimit = new Date(today);
  dueSoonLimit.setDate(dueSoonLimit.getDate() + dueSoonDays);

  const result: ReceivablesSummary = {
    issuedCents: 0,
    collectedCents: 0,
    outstandingCents: 0,
    overdueCents: 0,
    dueSoonCents: 0,
    draftCents: 0,
    documentCount: 0,
    overdueCount: 0,
    dueSoonCount: 0
  };

  for (const invoice of invoices) {
    if (!BILLABLE_TYPES.has(invoice.type) || invoice.status === "CANCELLED") continue;
    result.documentCount += 1;
    if (invoice.status === "DRAFT") {
      result.draftCents += invoice.totalCents;
      continue;
    }

    result.issuedCents += invoice.totalCents;
    const collected = Math.min(Math.max(invoice.paidCents || 0, 0), invoice.totalCents);
    result.collectedCents += collected;
    const outstanding = Math.max(invoice.totalCents - collected, 0);
    result.outstandingCents += outstanding;

    if (!outstanding || !invoice.dueDate) continue;
    const dueDate = dateOnly(invoice.dueDate);
    if (dueDate < today) {
      result.overdueCents += outstanding;
      result.overdueCount += 1;
    } else if (dueDate <= dueSoonLimit) {
      result.dueSoonCents += outstanding;
      result.dueSoonCount += 1;
    }
  }

  return result;
}
