/**
 * Trae datos de Holded y los convierte al formato del importador
 * (ClientInput / InvoiceInput), reutilizando el mismo pipeline de
 * preview/aplicación que la importación por archivo.
 */
import { holdedGetContact, holdedGetInvoice, holdedListContacts, holdedListInvoices, type HoldedInvoice } from "@/lib/integrations/holded";
import type { ClientInput } from "./clients";
import type { InvoiceInput } from "./invoices";

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function contactNameFrom(value: any): string {
  if (!value || typeof value !== "object") return "";
  return firstNonEmpty(value.name, value.contactName, value.tradeName, value.tradename);
}

function invoiceContactId(invoice: any): string {
  const contact = invoice?.contact;
  if (typeof contact === "string") return contact.trim();
  if (contact && typeof contact === "object") return String(contact.id ?? contact._id ?? "").trim();
  return String(invoice?.contactId ?? invoice?.contactid ?? invoice?.contact_id ?? "").trim();
}

/** Resuelve las variantes que Holded usa según el tipo/antigüedad del documento. */
export function embeddedInvoiceContactName(invoice: any): string {
  return firstNonEmpty(invoice?.contactName, invoice?.contactname) || contactNameFrom(invoice?.contact);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

/** Lee la dirección de facturación (billAddress) de un objeto Holded. */
function applyBillAddress(input: ClientInput, c: any): void {
  const a = c?.billAddress ?? c?.billaddress ?? null;
  if (a && typeof a === "object") {
    if (!input.fiscalAddress && a.address) input.fiscalAddress = String(a.address);
    if (!input.postalCode && (a.postalCode || a.postalcode)) input.postalCode = String(a.postalCode ?? a.postalcode);
    if (!input.city && a.city) input.city = String(a.city);
    if (!input.province && a.province) input.province = String(a.province);
  }
  if (!input.taxId && (c?.code || c?.vatnumber)) input.taxId = String(c.code ?? c.vatnumber);
  if (!input.email && c?.email) input.email = String(c.email);
  if (!input.phone && (c?.phone || c?.mobile)) input.phone = String(c.phone ?? c.mobile);
  const tn = c?.tradeName ?? c?.tradename;
  if (!input.legalName && tn && String(tn).trim() && String(tn).trim() !== input.name) {
    input.legalName = String(tn).trim();
  }
}

/** Contactos de Holded → clientes. La LISTA de Holded a veces no trae la
 *  dirección; en ese caso pedimos el DETALLE del contacto para completarla. */
export async function holdedContactsAsClients(workspaceId: string): Promise<ClientInput[]> {
  const contacts = await holdedListContacts({ workspaceId, limit: 5000 });
  const valid = contacts.filter((c) => c.name && c.name.trim());

  const out: ClientInput[] = [];
  let detailFetches = 0;
  const MAX_DETAIL = 600; // tope de seguridad para no eternizar el import
  for (const c of valid) {
    const input: ClientInput = { name: c.name.trim() };
    if (c.code) input.taxId = c.code;
    if (c.email) input.email = c.email;
    if (c.phone) input.phone = c.phone;
    applyBillAddress(input, c);
    // Si la lista no trajo dirección, pedimos el detalle del contacto.
    if (!input.fiscalAddress && detailFetches < MAX_DETAIL) {
      detailFetches++;
      try {
        const detail = await holdedGetContact(workspaceId, c.id);
        applyBillAddress(input, detail);
      } catch {
        // si el detalle falla, dejamos lo que haya
      }
    }
    out.push(input);
  }
  return out;
}

// Holded status: 0 pendiente, 1 pagada, 2 vencida, 3 cancelada, 4 borrador.
function mapStatus(s?: number): string {
  if (s === 1) return "PAID";
  if (s === 4) return "DRAFT";
  if (s === 3) return "CANCELLED";
  if (s === 0 || s === 2) return "ISSUED";
  // Fail closed: un estado nuevo o ausente nunca entra en una remesa.
  return "UNKNOWN";
}

/** Facturas de Holded → InvoiceInput. El total de Holded ya incluye IVA, así
 *  que lo tratamos como total (taxRate 0 para preservar el importe exacto). */
export async function holdedInvoicesAsInputs(
  workspaceId: string,
  options: { startTimestamp?: number; endTimestamp?: number; limit?: number } = {}
): Promise<InvoiceInput[]> {
  const invoices = await holdedListInvoices({
    workspaceId,
    limit: options.limit ?? 5000,
    startTimestamp: options.startTimestamp,
    endTimestamp: options.endTimestamp,
    sort: "created-desc"
  });
  const missingName = invoices.some((invoice) => !embeddedInvoiceContactName(invoice));
  const contacts = missingName ? await holdedListContacts({ workspaceId, limit: 5000 }).catch(() => []) : [];
  const contactsById = new Map(contacts.map((contact) => [String(contact.id), contact]));
  let detailFetches = 0;
  const MAX_INVOICE_DETAILS = 250;
  const enriched = await mapWithConcurrency(invoices, 10, async (invoice) => {
    const embeddedName = embeddedInvoiceContactName(invoice);
    if (embeddedName) return { ...invoice, contactName: embeddedName };
    const listedContactId = invoiceContactId(invoice);
    const listedContactName = contactNameFrom(contactsById.get(listedContactId));
    if (listedContactName) return { ...invoice, contactName: listedContactName };
    if (detailFetches >= MAX_INVOICE_DETAILS) return invoice;
    detailFetches++;
    try {
      const detail = await holdedGetInvoice({ workspaceId, invoiceId: invoice.id });
      const detailName = embeddedInvoiceContactName(detail);
      if (detailName) return { ...invoice, ...detail, contactName: detailName };
      const contactId = invoiceContactId(detail) || listedContactId;
      if (!contactId) return { ...invoice, ...detail };
      const contact = contactsById.get(contactId) ?? await holdedGetContact(workspaceId, contactId);
      const contactName = contactNameFrom(contact);
      return { ...invoice, ...detail, contactName: contactName || undefined } as HoldedInvoice;
    } catch {
      // La ausencia de nombre no debe impedir importar la factura. La siguiente
      // sincronización volverá a intentar completar el dato.
      return invoice;
    }
  });

  return enriched.map((i) => {
    const totalCents = typeof i.total === "number" ? Math.round(i.total * 100) : undefined;
    const currency = (i.currency ?? "EUR").toUpperCase().includes("USD") ? "USD" : "EUR";
    return {
      number: i.docNumber || undefined,
      date: i.date ? new Date(i.date * 1000).toISOString() : undefined,
      clientName: i.contactName || undefined,
      concept: i.desc || undefined,
      totalCents,
      taxRate: 0,
      currency,
      status: mapStatus(i.status)
    } as InvoiceInput;
  });
}
