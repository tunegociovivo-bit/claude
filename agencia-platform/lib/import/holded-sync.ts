/**
 * Trae datos de Holded y los convierte al formato del importador
 * (ClientInput / InvoiceInput), reutilizando el mismo pipeline de
 * preview/aplicación que la importación por archivo.
 */
import { holdedListContacts, holdedListInvoices } from "@/lib/integrations/holded";
import type { ClientInput } from "./clients";
import type { InvoiceInput } from "./invoices";
import { holdedGetContact } from "@/lib/integrations/holded";

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
  return "ISSUED";
}

/** Facturas de Holded → InvoiceInput. El total de Holded ya incluye IVA, así
 *  que lo tratamos como total (taxRate 0 para preservar el importe exacto). */
export async function holdedInvoicesAsInputs(workspaceId: string): Promise<InvoiceInput[]> {
  const invoices = await holdedListInvoices({ workspaceId, limit: 5000 });
  return invoices.map((i) => {
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
