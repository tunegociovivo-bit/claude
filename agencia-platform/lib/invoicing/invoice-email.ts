import { formatMoney } from "./core";

export type InvoiceReminderKey = "DUE_MINUS_3" | "OVERDUE_1" | "OVERDUE_7" | "OVERDUE_15";

export function invoiceRecipient(client: { email?: string | null } | null, snapshot: unknown): string | null {
  const frozen = snapshot && typeof snapshot === "object" ? (snapshot as { email?: unknown }).email : null;
  const value = typeof frozen === "string" && frozen.trim() ? frozen : client?.email;
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function getInvoiceReminderKey(dueDate: Date | null, now: Date): InvoiceReminderKey | null {
  if (!dueDate) return null;
  const daysAfterDue = Math.round((utcDay(now) - utcDay(dueDate)) / 86_400_000);
  if (daysAfterDue === -3) return "DUE_MINUS_3";
  if (daysAfterDue === 1) return "OVERDUE_1";
  if (daysAfterDue === 7) return "OVERDUE_7";
  if (daysAfterDue === 15) return "OVERDUE_15";
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function buildInvoiceEmail(input: {
  clientName: string;
  issuerName: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date | null;
  totalCents: number;
  outstandingCents: number;
  currency: string;
  kind: "INVOICE" | "REMINDER";
  reminderKey?: InvoiceReminderKey | null;
}) {
  const reminder = input.kind === "REMINDER";
  const subject = reminder
    ? `Recordatorio de factura ${input.invoiceNumber}`
    : `Factura ${input.invoiceNumber} de ${input.issuerName}`;
  const due = input.dueDate ? input.dueDate.toLocaleDateString("es-ES", { timeZone: "UTC" }) : "sin vencimiento indicado";
  const greeting = `Hola ${input.clientName},`;
  const main = reminder
    ? `Te recordamos que la factura ${input.invoiceNumber} tiene un saldo pendiente de ${formatMoney(input.outstandingCents, input.currency)} y vencimiento ${due}.`
    : `Te enviamos la factura ${input.invoiceNumber}, emitida por ${input.issuerName}, por un total de ${formatMoney(input.totalCents, input.currency)}.`;
  const text = `${greeting}\n\n${main}${reminder ? "\n\nSi ya has realizado el pago, puedes ignorar este recordatorio." : ""}\n\nGracias.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1e293b;line-height:1.55">
      <p>${escapeHtml(greeting)}</p>
      <p>${escapeHtml(main)}</p>
      <div style="margin:24px 0;padding:16px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">
        <strong>${escapeHtml(input.invoiceNumber)}</strong><br>
        Total: ${escapeHtml(formatMoney(input.totalCents, input.currency))}<br>
        Pendiente: ${escapeHtml(formatMoney(input.outstandingCents, input.currency))}<br>
        Vencimiento: ${escapeHtml(due)}
      </div>
      ${reminder ? "<p>Si ya has realizado el pago, puedes ignorar este recordatorio.</p>" : ""}
      <p>Gracias,<br>${escapeHtml(input.issuerName)}</p>
    </div>`;
  return { subject, html, text };
}
