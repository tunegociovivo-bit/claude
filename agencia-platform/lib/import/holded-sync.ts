/**
 * Trae datos de Holded y los convierte al formato del importador
 * (ClientInput / InvoiceInput), reutilizando el mismo pipeline de
 * preview/aplicación que la importación por archivo.
 */
import { holdedListContacts, holdedListInvoices } from "@/lib/integrations/holded";
import type { ClientInput } from "./clients";
import type { InvoiceInput } from "./invoices";

/** Contactos de Holded → clientes. */
export async function holdedContactsAsClients(workspaceId: string): Promise<ClientInput[]> {
  const contacts = await holdedListContacts({ workspaceId, limit: 5000 });
  return contacts
    .filter((c) => c.name && c.name.trim())
    .map((c) => {
      const input: ClientInput = { name: c.name.trim() };
      if (c.code) input.taxId = c.code;
      if (c.email) input.email = c.email;
      if (c.phone) input.phone = c.phone;
      // Holded incluye la dirección de facturación en el contacto.
      const a = (c as any).billAddress ?? (c as any).billaddress ?? null;
      if (a && typeof a === "object") {
        if (a.address) input.fiscalAddress = String(a.address);
        if (a.postalCode || a.postalcode) input.postalCode = String(a.postalCode ?? a.postalcode);
        if (a.city) input.city = String(a.city);
        if (a.province) input.province = String(a.province);
      }
      const tradeName = (c as any).tradeName ?? (c as any).tradename;
      if (tradeName && String(tradeName).trim() && String(tradeName).trim() !== c.name.trim()) {
        input.legalName = String(tradeName).trim();
      }
      return input;
    });
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
