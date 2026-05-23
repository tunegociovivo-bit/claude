/**
 * Ingesta de una factura de Meta (PDF) → la archiva como Gasto de Publicidad.
 *
 * Flujo: PDF → texto (pdf-parse) → IA extrae datos (cuenta, periodo, importes)
 * → mapea la cuenta publicitaria a una empresa/cliente → crea Expense
 * (categoría PUBLICIDAD, proveedor Meta) con el PDF adjunto. Idempotente por
 * número de factura. Copia opcional a Google Drive.
 *
 * Lo usa tanto el endpoint de la extensión de Chrome (recolector automático)
 * como la subida manual desde Facturación → Gastos.
 */
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { computeExpenseTotals } from "@/lib/invoicing/expenses";
import { parseFile } from "./parse";
import { parseAmountToCents, parseDateFlexible, pickRate, norm, nameTokens, nameSimilarity } from "./shared";
import { uploadBuffer, buildS3Key, signedDownloadUrl, isStorageEnabled } from "@/lib/storage/r2";

export type MetaInvoiceResult = {
  ok: boolean;
  action: "created" | "duplicate" | "error";
  expenseId?: string;
  adAccount?: string;
  invoiceNumber?: string;
  totalCents?: number;
  currency?: string;
  empresa?: string;
  reason?: string;
};

const AI_SCHEMA = {
  type: "object",
  properties: {
    isMetaInvoice: { type: "boolean", description: "true si es una factura/recibo de Meta/Facebook Ads" },
    adAccountName: { type: "string", description: "Nombre o ID de la cuenta publicitaria" },
    invoiceNumber: { type: "string", description: "Número de factura / referencia de transacción" },
    periodLabel: { type: "string", description: "Periodo facturado (p.ej. 'mayo 2026' o '01-31 may 2026')" },
    date: { type: "string", description: "Fecha de la factura (dd/mm/aaaa o ISO)" },
    base: { type: "string", description: "Base imponible / subtotal sin impuestos" },
    taxRate: { type: "string", description: "% de IVA aplicado (p.ej. 21)" },
    total: { type: "string", description: "Importe total (con impuestos)" },
    currency: { type: "string", description: "Moneda (EUR, USD…)" }
  },
  required: ["isMetaInvoice"]
};

type Extracted = {
  isMetaInvoice?: boolean;
  adAccountName?: string;
  invoiceNumber?: string;
  periodLabel?: string;
  date?: string;
  base?: string;
  taxRate?: string;
  total?: string;
  currency?: string;
};

/** Mapea el nombre de la cuenta publicitaria a una empresa emisora (issuer). */
async function resolveIssuer(workspaceId: string, adAccountName: string | undefined) {
  const issuers = await prisma.invoiceIssuer.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true }
  });
  if (issuers.length === 0) return null;
  // Empresa por defecto: "Negocio Vivo" si existe, si no la marcada por defecto.
  const negocioVivo = issuers.find((i) => norm(i.name).includes("negocio vivo"));
  return negocioVivo ?? issuers[0];
}

/** Intenta identificar el cliente por el nombre de la cuenta publicitaria. */
async function resolveClientName(workspaceId: string, adAccountName: string | undefined): Promise<string | null> {
  if (!adAccountName) return null;
  const clients = await prisma.client.findMany({
    where: { workspaceId, deletedAt: null },
    select: { name: true }
  });
  const tokens = nameTokens(adAccountName);
  let best: { name: string; score: number } | null = null;
  for (const c of clients) {
    const score = nameSimilarity(tokens, nameTokens(c.name));
    if (score >= 0.5 && (!best || score > best.score)) best = { name: c.name, score };
  }
  return best?.name ?? null;
}

export async function ingestMetaInvoice(opts: {
  workspaceId: string;
  buf: Buffer;
  filename: string;
  mimeType: string;
  uploadedBy?: string | null;
  hintAdAccount?: string;
  copyToDrive?: boolean;
}): Promise<MetaInvoiceResult> {
  // 1) Texto del PDF.
  let text = "";
  try {
    const parsed = await parseFile(opts.buf, opts.filename, opts.mimeType || "application/pdf");
    text = parsed.kind === "pdf" ? parsed.text : "";
  } catch (e: any) {
    return { ok: false, action: "error", reason: `No se pudo leer el PDF: ${e?.message ?? e}` };
  }
  if (!text.trim()) return { ok: false, action: "error", reason: "El PDF no tiene texto legible." };

  // 2) IA extrae los datos.
  let ex: Extracted;
  try {
    ex = await completeJson<Extracted>({
      workspaceId: opts.workspaceId,
      system:
        "Eres un extractor de datos de facturas de Meta/Facebook Ads. Extrae los campos del texto; no inventes importes. " +
        "Los importes pueden venir en formato español (1.234,56).",
      user: text.slice(0, 60_000),
      schema: AI_SCHEMA,
      maxTokens: 1024,
      feature: "meta-invoice-extract"
    } as any);
  } catch (e: any) {
    return { ok: false, action: "error", reason: `La IA no pudo leer la factura: ${e?.message ?? e}` };
  }

  if (ex.isMetaInvoice === false) {
    return { ok: false, action: "error", reason: "El archivo no parece una factura de Meta." };
  }

  const adAccount = ex.adAccountName || opts.hintAdAccount || "Cuenta Meta";
  const invoiceNumber = (ex.invoiceNumber || "").trim();
  const currency = (ex.currency || "EUR").toUpperCase().includes("USD") ? "USD" : "EUR";
  const totalCents = parseAmountToCents(ex.total);
  let baseCents = parseAmountToCents(ex.base);
  const taxRate = ex.taxRate ? pickRate(ex.taxRate) : 21;
  if (baseCents === null && totalCents !== null) {
    baseCents = Math.round(totalCents / (1 + taxRate / 100));
  }
  if (baseCents === null) return { ok: false, action: "error", reason: "No pude leer el importe de la factura." };
  const { taxCents, totalCents: computedTotal } = computeExpenseTotals(baseCents, taxRate);
  const date = parseDateFlexible(ex.date) ?? new Date();

  const issuer = await resolveIssuer(opts.workspaceId, adAccount);
  const clientName = await resolveClientName(opts.workspaceId, adAccount);

  // 3) Dedupe por número de factura (marcado en notes).
  const marker = invoiceNumber ? `[meta:${invoiceNumber}]` : `[meta:${adAccount}|${ex.periodLabel ?? ""}]`;
  const dup = await prisma.expense.findFirst({
    where: { workspaceId: opts.workspaceId, deletedAt: null, notes: { contains: marker } },
    select: { id: true }
  });
  if (dup) {
    return {
      ok: true,
      action: "duplicate",
      expenseId: dup.id,
      adAccount,
      invoiceNumber,
      totalCents: computedTotal,
      currency,
      empresa: issuer?.name
    };
  }

  // 4) Guardar el PDF (R2 + opcionalmente Drive) → fileUrl.
  let fileUrl: string | null = null;
  if (isStorageEnabled()) {
    try {
      const s3Key = buildS3Key({ workspaceId: opts.workspaceId, targetType: "EXPENSE", filename: opts.filename });
      await uploadBuffer({ s3Key, body: opts.buf, contentType: opts.mimeType || "application/pdf" });
      await prisma.file.create({
        data: {
          workspaceId: opts.workspaceId,
          name: opts.filename,
          mimeType: opts.mimeType || "application/pdf",
          sizeBytes: opts.buf.length,
          s3Key,
          targetType: "EXPENSE",
          uploadedBy: opts.uploadedBy ?? null
        }
      });
      fileUrl = await signedDownloadUrl(s3Key, 7 * 24 * 3600);
    } catch {
      // sin storage no bloqueamos la creación del gasto
    }
  }
  if (opts.copyToDrive) {
    try {
      const { uploadDriveFile } = await import("@/lib/integrations/google-drive");
      const driveName = `Meta ${ex.periodLabel ?? date.toISOString().slice(0, 7)} ${adAccount} ${invoiceNumber}`.trim();
      const df = await uploadDriveFile({
        workspaceId: opts.workspaceId,
        fileName: `${driveName}.pdf`.replace(/[\\/:*?"<>|]+/g, "-"),
        body: opts.buf,
        mimeType: opts.mimeType || "application/pdf"
      });
      if (df?.id) fileUrl = `https://drive.google.com/file/d/${df.id}/view`;
    } catch {
      // Drive opcional: si falla (no configurado, etc.) seguimos.
    }
  }

  // 5) Crear el Gasto.
  const concept =
    `Publicidad Meta — ${adAccount}` +
    (clientName ? ` (${clientName})` : "") +
    (ex.periodLabel ? ` · ${ex.periodLabel}` : "");
  const expense = await prisma.expense.create({
    data: {
      workspaceId: opts.workspaceId,
      issuerId: issuer?.id ?? null,
      date,
      category: "PUBLICIDAD",
      supplier: "Meta Platforms Ireland Ltd.",
      concept,
      currency,
      paymentMethod: "CARD",
      status: "PAID",
      baseCents,
      taxRate,
      taxCents,
      totalCents: computedTotal,
      deductible: true,
      notes: `${marker} Importado automático de factura Meta.`,
      fileUrl
    }
  });

  return {
    ok: true,
    action: "created",
    expenseId: expense.id,
    adAccount,
    invoiceNumber,
    totalCents: computedTotal,
    currency,
    empresa: issuer?.name
  };
}
