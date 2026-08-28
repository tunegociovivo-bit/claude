export type InvoiceAutomationWorkflow = "DRAFT" | "APPROVE" | "SEND";

export const RIXUS_ISSUER_PROFILE = {
  name: "RIXUS SOLUTIONS",
  legalName: "RIXUS SOLUTIONS LLC",
  taxId: "37-2141153",
  address: "407 LINCOLN RD STE 12-N",
  postalCode: "33139",
  city: "MIAMI BEACH",
  province: "FLORIDA",
  countryCode: "USA",
  personType: "J",
  residenceType: "E"
} as const;

export function addInvoicePaymentDays(issueDate: string, days = 30): string {
  const [year, month, day] = issueDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addInvoiceMonths(issueDate: string, months: number): string {
  const [year, month, day] = issueDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export type InvoiceRecurrenceUnit = "DAYS" | "MONTHS" | "YEARS";

export function addInvoiceInterval(issueDate: string, unit: InvoiceRecurrenceUnit, interval: number): string {
  const every = Math.max(1, Math.trunc(Number(interval) || 1));
  if (unit === "DAYS") return addInvoicePaymentDays(issueDate, every);
  return addInvoiceMonths(issueDate, unit === "YEARS" ? every * 12 : every);
}

export function recurringOccurrenceSchedule(
  nextRunAt: string,
  throughDate: string,
  unit: InvoiceRecurrenceUnit,
  interval: number,
  maxCatchUp = 366
): { dueDates: string[]; nextRunAt: string } {
  const dueDates: string[] = [];
  let cursor = nextRunAt;
  while (cursor <= throughDate && dueDates.length < maxCatchUp) {
    dueDates.push(cursor);
    cursor = addInvoiceInterval(cursor, unit, interval);
  }
  if (cursor <= throughDate) throw new Error(`Hay más de ${maxCatchUp} facturas recurrentes atrasadas; se requiere revisión`);
  return { dueDates, nextRunAt: cursor };
}

export function automationStatus(workflow: InvoiceAutomationWorkflow): "DRAFT" | "ISSUED" | "SENT" {
  if (workflow === "SEND") return "SENT";
  if (workflow === "APPROVE") return "ISSUED";
  return "DRAFT";
}

export function mergeInvoiceClients<T extends { id: string; name: string }>(clients: T[], client: T): T[] {
  const byId = new Map(clients.map((item) => [item.id, item]));
  byId.set(client.id, client);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function normalizeInitialInvoiceSequence(value: string | number): number {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 9_999_999_999) {
    throw new Error("El número inicial debe ser un entero entre 1 y 9.999.999.999");
  }
  return sequence;
}

export function formatInvoiceNumberPreview(series: string, year: number, next: number): string {
  const normalized = (series || "FAC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "FAC";
  return `${normalized}-${year}-${String(next).padStart(4, "0")}`;
}

export function nextInvoiceSequenceFromNumbers(
  numbers: Array<string | null | undefined>,
  series: string,
  year: number
): number {
  const prefix = `${series.toUpperCase()}-${year}-`;
  return numbers.reduce((next, number) => {
    if (!number?.toUpperCase().startsWith(prefix)) return next;
    const sequence = Number(number.slice(prefix.length));
    return Number.isSafeInteger(sequence) ? Math.max(next, sequence + 1) : next;
  }, 1);
}

export function invoiceRecipientEmail(snapshot: { email?: string | null; billingEmail?: string | null } | null | undefined): string {
  const email = snapshot?.billingEmail?.trim() || snapshot?.email?.trim();
  if (!email) throw new Error("El cliente no tiene un email de facturación");
  return email;
}

export function invoiceTaxLabel(rate: number, currency = "EUR"): string {
  const value = `${Number(rate).toLocaleString("es-ES")}%`;
  if (currency === "USD") return `Tax ${value}`;
  return Number(rate) === 0 ? "0% (sin IVA)" : `IVA ${value}`;
}

export function normalizeCustomInvoiceNumber(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,8}-\d{4}-\d{1,10}$/.test(normalized) || normalized.length > 40) {
    throw new Error("Formato de número inválido; utiliza SERIE-AÑO-SECUENCIA, por ejemplo FAC-2026-0001");
  }
  return normalized;
}

export function validateCustomInvoiceNumber(value: string, series: string, issueDate: string): string {
  const normalized = normalizeCustomInvoiceNumber(value);
  const [numberSeries, numberYear] = normalized.split("-");
  if (numberSeries !== series.toUpperCase()) throw new Error("La serie del número no coincide con la serie fiscal");
  if (Number(numberYear) !== Number(issueDate.slice(0, 4))) throw new Error("El año del número no coincide con la fecha de emisión");
  return normalized;
}
