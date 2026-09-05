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
  const signal = init.signal ? AbortSignal.any([ctrl.signal, init.signal]) : ctrl.signal;
  try {
    const resp = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        key,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {})
      },
      signal,
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

export function normalizeHoldedV2Invoices(payload: any): HoldedInvoice[] {
  const candidates = [payload, payload?.data, payload?.items, payload?.results, payload?.invoices,
    payload?.data?.items, payload?.data?.results, payload?.data?.invoices, payload?.data?.data];
  const hasInvoiceId = (row: any) => row?.id || row?._id || row?.invoiceId;
  const direct = candidates.find((value) => Array.isArray(value) && value.some(hasInvoiceId));
  const findRows = (value: any, depth = 0): any[] | null => {
    if (depth > 5 || value == null) return null;
    if (Array.isArray(value)) return value.some(hasInvoiceId) ? value : null;
    if (typeof value !== "object") return null;
    for (const child of Object.values(value)) {
      const found = findRows(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const rows = direct ?? findRows(payload) ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.map((row: any) => {
    const rawDate = row.issueDate ?? row.date ?? row.createdAt;
    const parsedDate = typeof rawDate === "number"
      ? (rawDate > 10_000_000_000 ? Math.floor(rawDate / 1000) : rawDate)
      : rawDate ? Math.floor(new Date(rawDate).getTime() / 1000) : undefined;
    return {
      id: String(row.id ?? row._id ?? row.invoiceId),
      contactName: row.contactName ?? row.contact?.name ?? row.customer?.name,
      contactEmail: row.contactEmail ?? row.contact?.email ?? row.customer?.email,
      contact: row.contactId ?? row.contact?.id ?? row.customer?.id,
      desc: row.description ?? row.desc,
      date: Number.isFinite(parsedDate) ? parsedDate : undefined,
      dueDate: row.dueDate ? Math.floor(new Date(row.dueDate).getTime() / 1000) : undefined,
      total: Number(row.total?.amount ?? row.total ?? row.totals?.total ?? 0),
      status: typeof row.status === "number" ? row.status : undefined,
      docNumber: row.documentNumber ?? row.docNumber ?? row.number,
      currency: row.currency?.code ?? row.currency
    };
  }).filter((row: HoldedInvoice) => row.id && row.id !== "undefined");
}

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
  signal?: AbortSignal;
}): Promise<HoldedInvoice[]> {
  const key = await getApiKey(opts.workspaceId);
  if (key.startsWith("pat_")) {
    const params = new URLSearchParams({ limit: String(Math.min(opts.limit ?? 100, 500)) });
    const resp = await fetch(`https://api.holded.com/api/v2/invoices?${params}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000), cache: "no-store"
    });
    if (!resp.ok) throw new Error(`Holded ${resp.status} /api/v2/invoices: ${(await resp.text()).slice(0, 200)}`);
    let rows = normalizeHoldedV2Invoices(await resp.json());
    if (opts.startTimestamp !== undefined) rows = rows.filter((row) => (row.date ?? 0) >= opts.startTimestamp!);
    if (opts.endTimestamp !== undefined) rows = rows.filter((row) => (row.date ?? 0) <= opts.endTimestamp!);
    if (opts.sort) rows.sort((a, b) => opts.sort === "created-asc" ? (a.date ?? 0) - (b.date ?? 0) : (b.date ?? 0) - (a.date ?? 0));
    return rows.slice(0, opts.limit ?? 100);
  }
  const params = new URLSearchParams();
  if (opts.status !== undefined) params.set("status", String(opts.status));
  if (opts.startTimestamp !== undefined) params.set("starttmp", String(opts.startTimestamp));
  if (opts.endTimestamp !== undefined) params.set("endtmp", String(opts.endTimestamp));
  if (opts.sort) params.set("sort", opts.sort);
  const qs = params.toString();
  const data = await holdedFetch<HoldedInvoice[]>(
    opts.workspaceId,
    `/invoicing/v1/documents/invoice${qs ? "?" + qs : ""}`,
    { signal: opts.signal }
  );
  return Array.isArray(data) ? data.slice(0, opts.limit ?? 100) : [];
}

export async function holdedGetInvoice(opts: {
  workspaceId: string;
  invoiceId: string;
  signal?: AbortSignal;
}): Promise<HoldedInvoice & { items?: any[] }> {
  return holdedFetch(opts.workspaceId, `/invoicing/v1/documents/invoice/${opts.invoiceId}`, { signal: opts.signal });
}

function nestedStrings(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return [value, ...nestedStrings(JSON.parse(trimmed), depth + 1)];
      } catch {
        // No era JSON serializado; se trata como una cadena normal.
      }
    }
    return [value];
  }
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).slice(0, 100).flatMap((entry) => nestedStrings(entry, depth + 1)).slice(0, 200);
}

export function decodeHoldedPdfPayload(payload: Buffer): Buffer {
  const asPdf = (candidate: Buffer): Buffer | null => {
    const start = candidate.subarray(0, 32).indexOf(Buffer.from("%PDF"));
    return start >= 0 ? candidate.subarray(start) : null;
  };
  const direct = asPdf(payload);
  if (direct) return direct;
  const rawText = payload.toString("utf8").trim();
  const rawBase64 = rawText
    .replace(/^data:application\/pdf(?:;[^,]*)?;base64,/i, "")
    .replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/_=-]+$/.test(rawBase64)) {
    const decodedRaw = asPdf(Buffer.from(rawBase64, "base64"));
    if (decodedRaw) return decodedRaw;
  }
  try {
    const json = JSON.parse(payload.toString("utf8"));
    const visit = (value: unknown, depth = 0): Buffer | null => {
      if (depth > 8 || value == null) return null;
      if (Array.isArray(value)) {
        if (value.length && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
          const bytes = asPdf(Buffer.from(value as number[]));
          if (bytes) return bytes;
        }
        if (value.length && value.every((entry) => typeof entry === "string")) {
          const joined = visit(value.join(""), depth + 1);
          if (joined) return joined;
        }
        for (const entry of value.slice(0, 200)) {
          const found = visit(entry, depth + 1);
          if (found) return found;
        }
        return null;
      }
      if (typeof value === "object") {
        for (const entry of Object.values(value as Record<string, unknown>).slice(0, 100)) {
          const found = visit(entry, depth + 1);
          if (found) return found;
        }
        return null;
      }
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (/^https?:\/\//i.test(trimmed)) return null;
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          const nested = visit(JSON.parse(trimmed), depth + 1);
          if (nested) return nested;
        } catch { /* cadena normal */ }
      }
      const normalized = trimmed
        .replace(/^data:application\/pdf(?:;[^,]*)?;base64,/i, "")
        .replace(/\s+/g, "");
      return asPdf(Buffer.from(normalized, "base64"));
    };
    const decoded = visit(json);
    if (decoded) return decoded;
  } catch {
    // La respuesta no era JSON; se informa con un error uniforme debajo.
  }
  throw new Error("Holded devolvió un archivo no PDF");
}

export function extractSafeHoldedPdfUrl(payload: Buffer): string {
  const json = JSON.parse(payload.toString("utf8"));
  const candidate = nestedStrings(json).find((value) => /^https?:\/\//i.test(value));
  if (!candidate) throw new Error("Holded devolvió una URL de PDF no segura");
  const url = new URL(candidate);
  const privateHost = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname) || url.hostname.endsWith(".local");
  if (url.protocol !== "https:" || privateHost) throw new Error("Holded devolvió una URL de PDF no segura");
  return url.toString();
}

/** Descarga el PDF oficial de una factura de Holded. */
export async function holdedGetInvoicePdf(opts: { workspaceId: string; invoiceId: string }): Promise<Buffer> {
  const key = await getApiKey(opts.workspaceId);
  const current = await fetch(`https://api.holded.com/api/v2/invoices/${encodeURIComponent(opts.invoiceId)}/pdf`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/pdf" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store"
  });
  if (current.ok) return decodeHoldedPdfPayload(Buffer.from(await current.arrayBuffer()));

  const legacy = await fetch(`${BASE}/invoicing/v1/documents/invoice/${encodeURIComponent(opts.invoiceId)}/pdf`, {
    headers: { key, Accept: "application/pdf, application/json" }, signal: AbortSignal.timeout(30_000), cache: "no-store"
  });
  if (!legacy.ok) throw new Error(`Holded ${current.status}/${legacy.status}: no se pudo descargar el PDF ${opts.invoiceId}`);
  const payload = Buffer.from(await legacy.arrayBuffer());
  try { return decodeHoldedPdfPayload(payload); } catch {
    const url = extractSafeHoldedPdfUrl(payload);
    const downloaded = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!downloaded.ok) throw new Error(`Holded ${downloaded.status}: no se pudo abrir el PDF ${opts.invoiceId}`);
    return decodeHoldedPdfPayload(Buffer.from(await downloaded.arrayBuffer()));
  }
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
export async function holdedGetContact(workspaceId: string, id: string, signal?: AbortSignal): Promise<any> {
  return holdedFetch<any>(workspaceId, `/invoicing/v1/contacts/${id}`, { signal });
}

export async function holdedListContacts(opts: {
  workspaceId: string;
  query?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<HoldedContact[]> {
  const data = await holdedFetch<HoldedContact[]>(opts.workspaceId, "/invoicing/v1/contacts", { signal: opts.signal });
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
  const key = await getApiKey(workspaceId);
  if (key.startsWith("pat_")) {
    const invoices = await holdedListInvoices({ workspaceId, limit: 5 });
    return { ok: true, invoicesSample: invoices.length, contactsSample: 0 };
  }
  const [invoices, contacts] = await Promise.all([
    holdedListInvoices({ workspaceId, limit: 5 }),
    holdedListContacts({ workspaceId, limit: 5 })
  ]);
  return { ok: true, invoicesSample: invoices.length, contactsSample: contacts.length };
}
