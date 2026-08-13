import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { computeTotals, type InvoiceLine } from "@/lib/invoicing/core";
import { snapshotIssuer, snapshotClient } from "@/lib/invoicing/persist";
import { pickHeaderRow, norm, normTaxId, nameTokens, nameSimilarity, parseAmountToCents, parseDateFlexible, pickRate } from "./shared";
import { tabularToText, type ParsedFile, type Tabular } from "./parse";

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
  /** Estado opcional (p.ej. al importar de Holded): PAID | ISSUED | DRAFT. */
  status?: string;
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

// Orden importante: `total` se evalúa antes que `base` para que una columna
// "Importe total" se asigne a total y no a base.
const ALIASES: Record<string, string[]> = {
  number: ["numero", "n factura", "numero factura", "invoice number", "num", "nº", "factura", "number", "serie numero", "ref", "referencia"],
  date: ["fecha", "fecha emision", "date", "issue date", "fecha factura", "f. emision", "f emision"],
  clientName: ["cliente", "client", "nombre cliente", "razon social", "destinatario", "nombre", "empresa"],
  clientTaxId: ["nif", "cif", "nif cliente", "nif/cif", "dni", "vat", "cif/nif"],
  concept: ["concepto", "descripcion", "description", "detalle", "conceptos", "servicio"],
  total: ["total", "total factura", "importe total", "total €", "total con iva", "importe", "import", "amount", "monto", "precio", "valor", "total eur", "total euros", "cobrado"],
  base: ["base", "base imponible", "subtotal", "neto", "base €", "b.i.", "bi", "base imponible €"],
  taxRate: ["iva", "iva %", "tipo iva", "% iva", "tipo", "vat rate"],
  taxAmount: ["cuota iva", "importe iva", "iva €", "cuota"],
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

function rowToInvoice(row: string[], cols: Record<string, number>): InvoiceInput {
  const get = (field: string): string => {
    const idx = cols[field];
    if (idx === undefined) return "";
    return (row[idx] ?? "").trim();
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

  // 1) Detección por columnas (exacta, sin coste). Busca la fila de cabecera
  //    real por si hay un título encima de la tabla.
  const viaCols = extractInvoicesByColumns(parsed.data);
  if (viaCols && viaCols.length) return viaCols;

  // 2) Si no se reconocen las columnas, lo interpreta la IA.
  let aiErr = "";
  try {
    const rows = await aiExtractInvoices(workspaceId, tabularToText(parsed.data));
    if (rows.length) return rows;
  } catch (e: any) {
    aiErr = String(e?.message ?? e);
  }

  const found = parsed.data.matrix?.[0]?.filter(Boolean).join(", ") || "ninguna";
  throw new Error(
    `No he podido leer las facturas del archivo. No encuentro la columna de importe ` +
      `(Total o Base imponible). Columnas detectadas: ${found}. ` +
      (aiErr
        ? `La IA tampoco pudo: ${aiErr}`
        : `Renombra la columna de importe a "Total" (o "Base imponible"), o configura la IA en /admin/ai para que lo interprete sola.`)
  );
}

/** Detección por cabeceras conocidas (sin IA). Devuelve null si no encuentra
 *  una fila de cabecera con columna de importe. */
function extractInvoicesByColumns(t: Tabular): InvoiceInput[] | null {
  if (!t.matrix?.length) return null;
  // 1) Cabeceras reconocidas con columna de importe explícita.
  const picked = pickHeaderRow(t.matrix, ALIASES, ["total", "base"]);
  if (picked) {
    const dataRows = t.matrix.slice(picked.headerIdx + 1).filter((r) => r.some((c) => c !== ""));
    return dataRows.map((r) => rowToInvoice(r, picked.cols));
  }
  // 2) Heurística por CONTENIDO: identifica la columna de importe como la
  //    columna con más celdas monetarias (y mayor suma). Resuelve Excels con
  //    cabeceras raras o sin cabecera de importe reconocible.
  return heuristicInvoices(t);
}

function heuristicInvoices(t: Tabular): InvoiceInput[] | null {
  const best = pickHeaderRow(t.matrix, ALIASES, []); // mejor fila aunque no tenga importe
  const headerIdx = best?.headerIdx ?? 0;
  const cols: Record<string, number> = { ...(best?.cols ?? {}) };
  const data = t.matrix.slice(headerIdx + 1).filter((r) => r.some((c) => c !== ""));
  if (data.length === 0) return null;
  const width = t.matrix[headerIdx]?.length ?? 0;

  // Columna de importe = la más "monetaria" (>=50% celdas parseables) con mayor suma.
  if (cols.total === undefined && cols.base === undefined) {
    let bestCol = -1;
    let bestSum = -1;
    for (let c = 0; c < width; c++) {
      if (c === cols.date || c === cols.number) continue;
      let money = 0;
      let sum = 0;
      for (const r of data) {
        const v = parseAmountToCents(r[c]);
        if (v !== null) {
          money++;
          sum += Math.abs(v);
        }
      }
      if (money >= Math.max(1, Math.floor(data.length * 0.5)) && sum > bestSum) {
        bestSum = sum;
        bestCol = c;
      }
    }
    if (bestCol >= 0) cols.total = bestCol;
  }
  if (cols.total === undefined && cols.base === undefined) return null;

  // Columna de cliente = primera columna mayormente de texto (no importe/fecha/nº).
  if (cols.clientName === undefined) {
    for (let c = 0; c < width; c++) {
      if (c === cols.total || c === cols.base || c === cols.date || c === cols.number) continue;
      let text = 0;
      for (const r of data) {
        const s = r[c];
        if (s && parseAmountToCents(s) === null && !/^\d/.test(s)) text++;
      }
      if (text >= Math.floor(data.length * 0.5)) {
        cols.clientName = c;
        break;
      }
    }
  }
  return data.map((r) => rowToInvoice(r, cols));
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
  const byTax = new Map<string, (typeof clients)[number] | null>();
  const byName = new Map<string, (typeof clients)[number] | null>();
  for (const c of clients) {
    const t = normTaxId(c.taxId);
    if (t) byTax.set(t, byTax.has(t) ? null : c);
    const normalizedName = norm(c.name);
    byName.set(normalizedName, byName.has(normalizedName) ? null : c);
  }
  const tokenizedClients = clients.map((client) => ({ client, tokens: nameTokens(client.name) }));

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

    const tax = normTaxId(input.clientTaxId);
    let match = (tax && byTax.get(tax)) || (input.clientName ? byName.get(norm(input.clientName)) : null) || null;
    if (!match && input.clientName) {
      const inputTokens = nameTokens(input.clientName);
      let best: { client: (typeof clients)[number]; score: number } | null = null;
      let ambiguous = false;
      for (const candidate of tokenizedClients) {
        const score = nameSimilarity(inputTokens, candidate.tokens);
        const sharedLong = inputTokens.some((token) => token.length >= 4 && candidate.tokens.includes(token));
        if (score < 0.6 || !sharedLong) continue;
        if (!best || score > best.score) {
          best = { client: candidate.client, score };
          ambiguous = false;
        } else if (score === best.score && candidate.client.id !== best.client.id) {
          ambiguous = true;
        }
      }
      match = best && !ambiguous ? best.client : null;
    }
    const numKey = input.number?.trim().toLowerCase();
    if (numKey && (existingNumbers.has(numKey) || seenInFile.has(numKey))) {
      items.push({
        input,
        action: "skip",
        reason: "Factura duplicada (mismo número)",
        clientMatchId: match?.id,
        clientMatchName: match?.name,
        clientUnmatched: !match,
        computedTotalCents: totals.totalCents,
        currency
      });
      continue;
    }
    if (numKey) seenInFile.add(numKey);

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
  inputs: InvoiceInput[],
  issuerId?: string
): Promise<{ created: number; skipped: number }> {
  const plan = await buildInvoicePlan(workspaceId, inputs);
  // Si se importa dentro de una empresa concreta, usamos esa; si no, la
  // emisora por defecto del workspace.
  const defaultIssuer = issuerId
    ? await prisma.invoiceIssuer.findFirst({ where: { id: issuerId, workspaceId, deletedAt: null } })
    : await prisma.invoiceIssuer.findFirst({
        where: { workspaceId, deletedAt: null },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
      });
  const issuerSnap = snapshotIssuer(defaultIssuer);

  let created = 0;
  let skipped = 0;
  for (const item of plan) {
    if (item.action === "skip") {
      // Holded puede omitir el nombre en la respuesta de listado. Cuando una
      // sincronización posterior ya lo conoce, repara el snapshot de la factura
      // existente sin crear duplicados ni tocar un cliente correcto.
      if (item.input.number && item.input.clientName) {
        const existing = await prisma.invoice.findFirst({
          where: { workspaceId, number: { equals: item.input.number, mode: "insensitive" }, deletedAt: null },
          select: { id: true, clientId: true, clientSnapshot: true, updatedAt: true }
        });
        const currentName = String((existing?.clientSnapshot as any)?.name ?? "").trim();
        const needsClientLink = !!existing && !existing.clientId && !!item.clientMatchId;
        if (existing && (!currentName || needsClientLink)) {
          const client = item.clientMatchId
            ? await prisma.client.findUnique({ where: { id: item.clientMatchId } })
            : null;
          const clientSnap = client
            ? snapshotClient(client)
            : { name: item.input.clientName, taxId: item.input.clientTaxId ?? null, countryCode: "ESP" };
          await prisma.invoice.updateMany({
            where: {
              id: existing.id,
              workspaceId,
              updatedAt: existing.updatedAt,
              ...(needsClientLink ? { clientId: null } : {})
            },
            data: {
              clientId: existing.clientId ?? item.clientMatchId ?? null,
              ...(!currentName ? { clientSnapshot: clientSnap as any } : {})
            }
          });
        }
      }
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
    const status = input.status ?? (input.number ? "ISSUED" : "DRAFT");
    const isPaid = status === "PAID";
    const documentType = /^R-/i.test(input.number?.trim() ?? "") ? "RECTIFICATIVA" : "NORMAL";
    await prisma.invoice.create({
      data: {
        workspaceId,
        type: documentType,
        status,
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
        totalCents: totals.totalCents,
        paidCents: isPaid ? totals.totalCents : 0,
        ...(isPaid ? { paidAt: input.date ? new Date(input.date) : new Date() } : {})
      }
    });
    created++;
  }
  return { created, skipped };
}

/** Completa únicamente el cliente de facturas ya existentes; nunca crea documentos. */
export async function repairExistingInvoiceClients(
  workspaceId: string,
  inputs: InvoiceInput[]
): Promise<{ examined: number; repaired: number }> {
  const plan = await buildInvoicePlan(workspaceId, inputs);
  const duplicates = plan.filter((item) => item.action === "skip" && item.input.number && item.input.clientName);
  let repaired = 0;
  for (const item of duplicates) {
    const changed = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({
        where: { workspaceId, number: { equals: item.input.number!, mode: "insensitive" }, deletedAt: null },
        select: { id: true, clientId: true, clientSnapshot: true, updatedAt: true }
      });
      if (!existing) return false;
      const currentName = String((existing.clientSnapshot as any)?.name ?? "").trim();
      const needsClientLink = !existing.clientId && !!item.clientMatchId;
      if (currentName && !needsClientLink) return false;

      // Si ya existe vínculo, es la fuente de verdad; nunca mezclar su ID con
      // el snapshot de otro match obtenido por nombre.
      const resolvedClientId = existing.clientId ?? item.clientMatchId ?? null;
      const client = resolvedClientId
        ? await tx.client.findFirst({ where: { id: resolvedClientId, workspaceId, deletedAt: null } })
        : null;
      const clientSnap = client
        ? snapshotClient(client)
        : { name: item.input.clientName!, taxId: item.input.clientTaxId ?? null, countryCode: "ESP" };
      const result = await tx.invoice.updateMany({
        // `updatedAt` funciona como guarda optimista: si otro proceso reparó
        // la factura tras leerla, no sobrescribimos su corrección.
        where: {
          id: existing.id,
          workspaceId,
          updatedAt: existing.updatedAt,
          ...(!existing.clientId ? { clientId: null } : {})
        },
        data: {
          clientId: resolvedClientId,
          ...(!currentName ? { clientSnapshot: clientSnap as any } : {})
        }
      });
      return result.count === 1;
    });
    if (changed) repaired++;
  }
  return { examined: duplicates.length, repaired };
}
