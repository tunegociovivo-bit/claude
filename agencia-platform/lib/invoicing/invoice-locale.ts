import { isRixusIssuer, type InvoiceType, type PaymentMethod } from "./core";
import type { InvoiceForHtml } from "./invoice-html";

export type InvoiceLanguage = "es" | "en";

const ES = {
  invoice: "Factura", rectifying: "Factura rectificativa", proforma: "Factura proforma", quote: "Presupuesto",
  draft: "BORRADOR", issueDate: "Fecha", dueDate: "Vencimiento", billTo: "Facturar a", for: "Para",
  concept: "Concepto", description: "Descripción", unitPrice: "Precio", quantity: "Unidades", subtotal: "Subtotal",
  taxes: "Impuestos", total: "Total", taxableBase: "Base imponible", paymentMethod: "Forma de pago",
  notes: "Notas", terms: "Condiciones", print: "Imprimir / Guardar PDF", taxId: "NIF/CIF",
  taxOn: "sobre", line: "Línea", fullDetail: "DETALLE COMPLETO DE CONCEPTOS",
  payments: { STRIPE: "Stripe", TRANSFER: "Transferencia bancaria", REMITTANCE: "Remesa bancaria (SEPA)", CARD: "Tarjeta", CASH: "Efectivo", OTHER: "Otro" }
} as const;

const EN = {
  invoice: "Invoice", rectifying: "Credit invoice", proforma: "Proforma invoice", quote: "Quote",
  draft: "DRAFT", issueDate: "Issue date", dueDate: "Due date", billTo: "Bill to", for: "For",
  concept: "Item", description: "Description", unitPrice: "Unit price", quantity: "Quantity", subtotal: "Subtotal",
  taxes: "Taxes", total: "Total", taxableBase: "Subtotal", paymentMethod: "Payment method",
  notes: "Notes", terms: "Terms", print: "Print / Save PDF", taxId: "Tax ID",
  taxOn: "on", line: "Line", fullDetail: "FULL ITEM DETAILS",
  payments: { STRIPE: "Stripe", TRANSFER: "Bank transfer", REMITTANCE: "Bank direct debit (SEPA)", CARD: "Card", CASH: "Cash", OTHER: "Other" }
} as const;

export function invoiceLanguage(invoice: Pick<InvoiceForHtml, "currency" | "issuer">): InvoiceLanguage {
  return isRixusIssuer(invoice.issuer) && invoice.currency.toUpperCase() === "USD" ? "en" : "es";
}

export function invoiceLabels(language: InvoiceLanguage) { return language === "en" ? EN : ES; }

export function localizedTypeLabel(type: string, language: InvoiceLanguage): string {
  const labels = invoiceLabels(language);
  return ({ NORMAL: labels.invoice, RECTIFICATIVA: labels.rectifying, PROFORMA: labels.proforma, PRESUPUESTO: labels.quote } as Record<InvoiceType, string>)[type as InvoiceType] ?? labels.invoice;
}

export function localizedPaymentLabel(method: string, language: InvoiceLanguage): string {
  return invoiceLabels(language).payments[method as PaymentMethod] ?? method;
}

export function localizedDate(value: Date, language: InvoiceLanguage): string {
  return new Date(value).toLocaleDateString(language === "en" ? "en-US" : "es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}
