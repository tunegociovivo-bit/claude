import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { computeTotals, type InvoiceLine } from "@/lib/invoicing/core";
import { snapshotIssuer, snapshotClient } from "@/lib/invoicing/persist";
import { detectColumns, norm, normTaxId, parseAmountToCents, parseDateFlexible, pickRate } from "./shared";
import { tabularToObjects, type ParsedFile, type Tabular } from "./parse";

export type InvoiceInput = {
  number?: string;
  date?: string; // ISO
  clientName?: string;
  clientTaxId?: string;
  concept?: string;
  baseCents?: number;
  taxRate?: number;
  totalCents?: number;
  currency?: string;
  paymentMethod?: string;
};

export type InvoicePlanItem = {
  input: InvoiceInput;
  action: "create" | "skip";
  reason?: string;
  clientMatchId?: string;
  clientMatchName?: string;
  clientUnmatched?: boolean;
  computedTotalCents: number;
  currency: string;
};

const ALIASES: Record<string, string[]> = {
  number: ["numero", "n factura", "numero factura", "invoice number", "num", "nº", "n", "factura", "number", "serie numero"],
  date: ["fecha", "fecha emision", "date", "issue date", "fecha factura", "f. emision"],
  clientName: ["cliente", "client", "nombre cliente", "razon social", "destinatario", "nombre"],
  clientTaxId: ["nif", "cif", "nif cliente", "nif/cif", "dni", "vat"],
  concept: ["concepto", "descripcion", "description", "detalle", "conceptos"],
  base: ["base", "base imponible", "subtotal", "neto", "importe", "base €"],
  taxRate: ["iva", "iva %", "tipo iva", "vat", "% iva", "tipo"],
  taxAmount: ["cuota iva", "importe iva", "iva €", "cuota"],
  total: ["total", "total factura", "importe total", "total €", "total con iva"],
  currency: ["moneda", "divisa", "currency"],
  paymentMethod: ["forma de pago", "metodo de pago", "pago", "payment", "forma pago"]
};

function normalizePaymentMethod(raw?: string): string {
  const v = norm(raw ?? "");
  if (!v) return "OTHER";
  if (v.includes("transfer")) return "TRANSFER";
  if (v.includes("stripe")) return "STRIPE";
  if (v.includes("remesa") || v.includes("sepa")) return "REMITTANCE";
  if (v.includes("tarjeta") || v.includes("card")) return "CARD";
  if (v.includes("efectivo") || v.includes("cash") || v.includes("contado")) return "CASH";
  return "OTHER";
}

function normalizeCurrency(raw?: string): string {
  const v = (raw ?? "").toUpperCase();
  if (v.includes("USD") || v.includes("$") || v.includes("DOLAR")) return "USD";
  return "EUR";
}

function rowToInvoice(obj: Record<string, string>, cols: Record<string, number>, headers: string[]): InvoiceInput {
  const get = (field: string): string => {
    const idx = cols[field];
    if (idx === undefined) return "";
    return (obj[headers[idx]] ?? "").trim();
  };
  const baseCents = parseAmountToCents(get("base"));
  const totalCents = parseAmountToCents(get("total"));
  const date = parseDateFlexible(get("date"));
  return {
    number: get("number") || undefined,
    date: date ? date.toISOString() : undefined,
    clientName: get("clientName") || undefined,
    clientTaxId: get("clientTaxId") || undefined,
    concept: get("concept") || undefined,
    baseCents: baseCents ?? undefined,
    taxRate: pickRate(get("taxRate")),
    totalCents: totalCents ?? undefined,
    currency: normalizeCurrency(get("currency")),
    paymentMethod: normalizePaymentMethod(get("paymentMethod"))
  };
}

const AI_SCHEMA = {
  type: "object",
  properties: {
    invoices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "string" },
          date: { type: "string", description: "Fecha de emisión en formato dd/mm/aaaa o ISO" },
          clientName: { type: "string" },
          clientTaxId: { type: "string" },
          concept: { type: "string" },
          base: { type: "string", description: "Base imponible (sin IVA)" },
          taxRate: { type: "string", description: "Porcentaje de IVA, p.ej. 21" },
          total: { type: "string", description: "Importe total con IVA" },
          currency: { type: "string" },
          paymentMethod: { type: "string" }
        }
      }
    }
  },
  required: ["invoices"]
};

async function aiExtractInvoices(workspaceId: string, text: string): Promise<InvoiceInput[]> {
  const res = await completeJson<{ invoices: any[] }>({
    workspaceId,
    system:
      "Eres un extractor de datos. Te paso el texto de un PDF que contiene un LISTADO de facturas (o una o varias facturas). " +
      "Devuelve un array con un objeto por factura. Extrae solo lo que aparezca; no inventes importes. " +
      "Los importes pueden venir en formato español (1.234,56).",
    user: text.slice(0, 100_000),
    schema: AI_SCHEMA,
    maxTokens: 8192,
    feature: "import-invoices-pdf"
  } as any);
  return (res.invoices ?? []).map((r) => ({
    number: r.number || undefined,
    date: r.date ? (parseDateFlexible(r.date)?.toISOString() ?? undefined) : undefined,
    clientName: r.clientName || undefined,
    clientTaxId: r.clientTaxId || undefined,
    concept: r.concept || undefined,
    baseCents: parseAmountToCents(r.base) ?? undefined,
    taxRate: pickRate(r.taxRate),
    totalCents: parseAmountToCents(r.total) ?? undefined,
    currency: normalizeCurrency(r.currency),
    paymentMethod: normalizePaymentMethod(r.paymentMethod)
  }));
}

export async function extractInvoiceInputs(workspaceId: string, parsed: ParsedFile): Promise<InvoiceInput[]> {
  if (parsed.kind === "pdf") return aiExtractInvoices(workspaceId, parsed.text);
  const t: Tabular = parsed.data;
  const cols = detectColumns(t.headers, ALIASES);
  if (cols.total === undefined && cols.base === undefined) {
    throw new Error("No se ha encontrado columna de importe (Total o Base imponible).");
  }
  const objects = tabularToObjects(t);
  return objects.map((o) => rowToInvoice(o, cols, t.headers));
}

function buildLine(input: InvoiceInput): InvoiceLine {
  const rate = input.taxRate ?? 21;
  let baseCents = input.baseCents;
  if (baseCents === undefined && input.totalCents !== undefined) {
    baseCents = Math.round(input.totalCents / (1 + rate / 100));
  }
  return {
    description: input.concept || "Importado",
    quantity: 1,
    unitPriceCents: baseCents ?? 0,
    taxRate: rate
  };
}

/** Empareja clientes y detecta duplicados por número de factura. */
export async function buildInvoicePlan(workspaceId: string, inputs: InvoiceInput[]): Promise<InvoicePlanItem[]> {
  const clients = await prisma.client.findMany({
    where: { workspaceId, deletedAt: null },
    select: { id: true, name: true, taxId: true }
  });
  const byTax = new Map<string, (typeof clients)[number]>();
  const byName = new Map<string, (typeof clients)[number]>();
  for (const c of clients) {
    const t = normTaxId(c.taxId);
    if (t) byTax.set(t, c);
    byName.set(norm(c.name), c);
  }

  const existingNumbers = new Set(
    (
      await prisma.invoice.findMany({
        where: { workspaceId, number: { not: null }, deletedAt: null },
        select: { number: true }
      })
    ).map((i) => i.number!.toLowerCase())
  );

  const seenInFile = new Set<string>();
  const items: InvoicePlanItem[] = [];
  for (const input of inputs) {
    const line = buildLine(input);
    const totals = computeTotals([line]);
    const currency = input.currency || "EUR";

    const numKey = input.number?.trim().toLowerCase();
    if (numKey && (existingNumbers.has(numKey) || seenInFile.has(numKey))) {
      items.push({
        input,
        action: "skip",
        reason: "Factura duplicada (mismo número)",
        computedTotalCents: totals.totalCents,
        currency
      });
      continue;
    }
    if (numKey) seenInFile.add(numKey);

    const tax = normTaxId(input.clientTaxId);
    const match = (tax && byTax.get(tax)) || (input.clientName ? byName.get(norm(input.clientName)) : null) || null;

    items.push({
      input,
      action: "create",
      clientMatchId: match?.id,
      clientMatchName: match?.name,
      clientUnmatched: !match,
      computedTotalCents: totals.totalCents,
      currency
    });
  }
  return items;
}

export async function applyInvoiceImport(
  workspaceId: string,
  inputs: InvoiceInput[]
): Promise<{ created: number; skipped: number }> {
  const plan = await buildInvoicePlan(workspaceId, inputs);
  const defaultIssuer = await prisma.invoiceIssuer.findFirst({
    where: { workspaceId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
  });
  const issuerSnap = snapshotIssuer(defaultIssuer);

  let created = 0;
  let skipped = 0;
  for (const item of plan) {
    if (item.action === "skip") {
      skipped++;
      continue;
    }
    const input = item.input;
    const line = buildLine(input);
    const totals = computeTotals([line]);

    let clientSnap: any = null;
    if (item.clientMatchId) {
      const client = await prisma.client.findUnique({ where: { id: item.clientMatchId } });
      clientSnap = snapshotClient(client);
    } else if (input.clientName) {
      clientSnap = { name: input.clientName, taxId: input.clientTaxId ?? null, countryCode: "ESP" };
    }

    const series = input.number?.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || "IMP";
    await prisma.invoice.create({
      data: {
        workspaceId,
        type: "NORMAL",
        status: input.number ? "ISSUED" : "DRAFT",
        series,
        number: input.number ?? null,
        issuerId: defaultIssuer?.id ?? null,
        clientId: item.clientMatchId ?? null,
        issuerSnapshot: issuerSnap ?? undefined,
        clientSnapshot: clientSnap ?? undefined,
        issueDate: input.date ? new Date(input.date) : new Date(),
        currency: input.currency || "EUR",
        paymentMethod: input.paymentMethod || "OTHER",
        lines: [line] as any,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents
      }
    });
    created++;
  }
  return { created, skipped };
}
