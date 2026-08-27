/**
 * Cliente Holded REST API v1.
 *
 * Holded es el ERP/contabilidad/facturación all-in-one español que
 * usamos para invoicing, quotes, contacts, productos, banking. Su API
 * autentica con header `key: <api-key>` (no Bearer).
 *
 * Docs: https://developers.holded.com
 *
 * Configuración esperada en workspace.settings.integrations.holded:
 *   { apiKey: "<encrypted>" }
 *
 * La API key se obtiene en Holded → Configuración → Developers.
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const BASE = "https://api.holded.com/api";

async function getApiKey(workspaceId: string): Promise<string> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const encrypted = (ws?.settings as any)?.integrations?.holded?.apiKey;
  if (!encrypted) throw new Error("Holded no configurado: falta API key");
  const key = decryptSecret(encrypted);
  if (!key) throw new Error("Holded API key inválida (no se pudo descifrar)");
  return key;
}

async function holdedFetch<T = any>(
  workspaceId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const key = await getApiKey(workspaceId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        key,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {})
      },
      signal: ctrl.signal,
      cache: "no-store"
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Holded ${resp.status} ${path}: ${txt.slice(0, 200)}`);
    }
    return (await resp.json()) as T;
  } catch (e: any) {
    clearTimeout(timer);
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────
// Invoices (facturas)
// ─────────────────────────────────────────────────────────────────

export type HoldedInvoice = {
  id: string;
  contactName?: string;
  contactEmail?: string;
  contact?: string;
  desc?: string;
  date?: number; // unix
  dueDate?: number;
  total?: number;
  status?: number; // 0 = pendiente, 1 = pagada, etc.
  docNumber?: string;
  currency?: string;
};

const INVOICE_STATUS: Record<number, string> = {
  0: "pendiente",
  1: "pagada",
  2: "vencida",
  3: "cancelada",
  4: "borrador"
};

export function holdedInvoiceStatusLabel(s?: number): string {
  if (s === undefined) return "?";
  return INVOICE_STATUS[s] ?? `code:${s}`;
}

export async function holdedListInvoices(opts: {
  workspaceId: string;
  status?: number; // si se omite, todas
  limit?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  sort?: "created-asc" | "created-desc";
}): Promise<HoldedInvoice[]> {
  const params = new URLSearchParams();
  if (opts.status !== undefined) params.set("status", String(opts.status));
  if (opts.startTimestamp !== undefined) params.set("starttmp", String(opts.startTimestamp));
  if (opts.endTimestamp !== undefined) params.set("endtmp", String(opts.endTimestamp));
  if (opts.sort) params.set("sort", opts.sort);
  const qs = params.toString();
  const data = await holdedFetch<HoldedInvoice[]>(
    opts.workspaceId,
    `/invoicing/v1/documents/invoice${qs ? "?" + qs : ""}`
  );
  return Array.isArray(data) ? data.slice(0, opts.limit ?? 100) : [];
}

export async function holdedGetInvoice(opts: {
  workspaceId: string;
  invoiceId: string;
}): Promise<HoldedInvoice & { items?: any[] }> {
  return holdedFetch(opts.workspaceId, `/invoicing/v1/documents/invoice/${opts.invoiceId}`);
}

/** Documento recurrente de Holded (plantilla). Los nombres de campo varían según la
 *  antigüedad/tipo; el importador es DEFENSIVO y normaliza varias variantes. */
export type HoldedRecurring = {
  id: string;
  contactName?: string;
  contact?: any;
  contactId?: string;
  desc?: string;
  currency?: string;
  total?: number;
  items?: any[];
  // marcadores de periodicidad (variantes conocidas de Holded)
  periodicity?: string | number;
  period?: string | number;
  every?: number;
  nextInvoiceDate?: number;
  nextDate?: number;
  startDate?: number;
  endDate?: number;
  status?: number | string;
};

/**
 * Lista las RECURRENCIAS (plantillas) de Holded. El endpoint de recurrentes de Holded no
 * está uniformemente documentado entre cuentas; probamos el path configurable
 * `HOLDED_RECURRING_PATH` y, si no, los candidatos habituales. Devuelve SOLO lo que Holded
 * responde (crudo, normalizado a array). Es de SOLO LECTURA — seguro para dry-run: si el
 * endpoint no existe en esta cuenta, se propaga el error para mostrarlo en el preview.
 */
export async function holdedListRecurringInvoices(opts: { workspaceId: string; limit?: number }): Promise<HoldedRecurring[]> {
  const envPath = (process.env.HOLDED_RECURRING_PATH || "").trim();
  const candidates = envPath
    ? [envPath]
    : ["/invoicing/v1/documents/recurringinvoice", "/invoicing/v1/documents/invoicerecurring", "/invoicing/v1/documents/recurring"];
  let lastErr: any = null;
  for (const path of candidates) {
    try {
      const data = await holdedFetch<HoldedRecurring[]>(opts.workspaceId, path);
      if (Array.isArray(data)) return data.slice(0, opts.limit ?? 1000);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Holded: no se pudo listar recurrencias (endpoint no disponible)");
}

// ─────────────────────────────────────────────────────────────────
// Contacts (clientes/proveedores)
// ─────────────────────────────────────────────────────────────────

export type HoldedContact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  code?: string; // CIF/NIF
  type?: string;
  isperson?: boolean;
};

/** Detalle completo de un contacto (incluye billAddress, vatnumber, etc.). */
export async function holdedGetContact(workspaceId: string, id: string): Promise<any> {
  return holdedFetch<any>(workspaceId, `/invoicing/v1/contacts/${id}`);
}

export async function holdedListContacts(opts: {
  workspaceId: string;
  query?: string;
  limit?: number;
}): Promise<HoldedContact[]> {
  const data = await holdedFetch<HoldedContact[]>(opts.workspaceId, "/invoicing/v1/contacts");
  if (!Array.isArray(data)) return [];
  let filtered = data;
  if (opts.query) {
    const q = opts.query.toLowerCase();
    filtered = data.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.code?.toLowerCase().includes(q)
    );
  }
  return filtered.slice(0, opts.limit ?? 50);
}

// ─────────────────────────────────────────────────────────────────
// Quotes (presupuestos / estimates)
// ─────────────────────────────────────────────────────────────────

export type HoldedQuote = HoldedInvoice;

export async function holdedListQuotes(opts: {
  workspaceId: string;
  status?: number;
  limit?: number;
}): Promise<HoldedQuote[]> {
  const data = await holdedFetch<HoldedQuote[]>(opts.workspaceId, "/invoicing/v1/documents/estimate");
  return Array.isArray(data) ? data.slice(0, opts.limit ?? 100) : [];
}

// ─────────────────────────────────────────────────────────────────
// Crear factura / presupuesto (los drafts de Sonia llaman aquí)
// ─────────────────────────────────────────────────────────────────

export type HoldedCreateDocPayload = {
  contactId?: string;
  contactName?: string;
  desc?: string;
  date?: number; // unix
  dueDate?: number;
  items: Array<{
    name: string;
    units: number;
    subtotal: number; // precio unitario sin IVA
    tax?: number; // % IVA (21, 10, 4, 0)
    discount?: number;
  }>;
  notes?: string;
};

export async function holdedCreateInvoice(opts: {
  workspaceId: string;
  payload: HoldedCreateDocPayload;
}): Promise<{ id: string; docNumber?: string }> {
  const resp = await holdedFetch<any>(
    opts.workspaceId,
    "/invoicing/v1/documents/invoice",
    { method: "POST", body: JSON.stringify(opts.payload) }
  );
  return { id: resp.id ?? resp.invoiceId, docNumber: resp.docNumber };
}

export async function holdedCreateQuote(opts: {
  workspaceId: string;
  payload: HoldedCreateDocPayload;
}): Promise<{ id: string; docNumber?: string }> {
  const resp = await holdedFetch<any>(
    opts.workspaceId,
    "/invoicing/v1/documents/estimate",
    { method: "POST", body: JSON.stringify(opts.payload) }
  );
  return { id: resp.id ?? resp.estimateId, docNumber: resp.docNumber };
}

export async function holdedTest(workspaceId: string): Promise<{
  ok: true;
  invoicesSample: number;
  contactsSample: number;
}> {
  const [invoices, contacts] = await Promise.all([
    holdedListInvoices({ workspaceId, limit: 5 }),
    holdedListContacts({ workspaceId, limit: 5 })
  ]);
  return { ok: true, invoicesSample: invoices.length, contactsSample: contacts.length };
}
