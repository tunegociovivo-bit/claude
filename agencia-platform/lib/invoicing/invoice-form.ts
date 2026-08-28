export type InvoiceAutomationWorkflow = "DRAFT" | "APPROVE" | "SEND";

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

export function automationStatus(workflow: InvoiceAutomationWorkflow): "DRAFT" | "ISSUED" | "SENT" {
  if (workflow === "SEND") return "SENT";
  if (workflow === "APPROVE") return "ISSUED";
  return "DRAFT";
}

export function formatInvoiceNumberPreview(series: string, year: number, next: number): string {
  const normalized = (series || "FAC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "FAC";
  return `${normalized}-${year}-${String(next).padStart(4, "0")}`;
}

export function invoiceRecipientEmail(snapshot: { email?: string | null; billingEmail?: string | null } | null | undefined): string {
  const email = snapshot?.billingEmail?.trim() || snapshot?.email?.trim();
  if (!email) throw new Error("El cliente no tiene un email de facturación");
  return email;
}

export function invoiceTaxLabel(rate: number): string {
  return Number(rate) === 0 ? "0% (sin IVA)" : `IVA ${Number(rate).toLocaleString("es-ES")}%`;
}
