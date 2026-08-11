/**
 * Importador de plantillas recurrentes (Slice A) — lógica PURA (sin BD, sin red).
 *
 * Parseo CSV/JSON seguro (anti *formula injection*), mapeo de columnas, validación
 * por fila, cálculo de totales en céntimos (reutiliza computeTotals), checksum para
 * dedupe/idempotencia. NO crea/emite facturas: solo produce plantillas `draft`.
 */
import { computeTotals, type InvoiceLine } from "@/lib/invoicing/core";

// ── Saneado anti formula-injection ──────────────────────────────────────────
// Celdas que empiezan por = + - @ (o tab/CR) pueden ejecutar fórmulas si el CSV
// se abre en Excel/Sheets. Se neutralizan con un apóstrofo (patrón OWASP).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
export function sanitizeCell(v: string): string {
  const s = String(v ?? "");
  return FORMULA_PREFIX.test(s) ? `'${s}` : s;
}

// ── CSV parser (RFC4180-ish: comillas, comas y saltos escapados) ─────────────
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ── Números y fechas ────────────────────────────────────────────────────────
/** Euros → céntimos. Acepta "1.234,56", "1234.56", "1234,56", "€", espacios. */
export function eurosToCents(raw: string | number): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  let s = String(raw).trim().replace(/[€\s]/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // el último separador es el decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot) {
    // Punto suelto ambiguo: "10.50" (decimal, 1-2 cifras) vs "1.200" (millar, 3
    // cifras) vs "1.234.567" (millares). Heurística europea:
    const idx = s.indexOf(".");
    const frac = s.slice(s.lastIndexOf(".") + 1);
    const singleDot = idx === s.lastIndexOf(".");
    if (singleDot && (frac.length === 1 || frac.length === 2)) {
      // decimal → se deja tal cual
    } else {
      s = s.replace(/\./g, ""); // separador de millares → se quita
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function parseIsoDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // dd/mm/yyyy o dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

// ── Mapeo + validación ──────────────────────────────────────────────────────
export type ImportRow = Record<string, string>;

export type ParsedTemplate = {
  externalId: string;
  issuerTaxId: string | null;
  issuerName: string | null;
  clientName: string | null;
  clientTaxId: string | null;
  clientEmail: string | null;
  lines: InvoiceLine[];
  currency: string;
  intervalMonths: number;
  dayOfMonth: number | null;
  startDate: Date | null;
  endDate: Date | null;
  paymentMethod: string;
  series: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  checksum: string;
  original: ImportRow[];
};

export type RowError = { field: string; message: string };
export type ImportItemResult = { externalId: string; ok: boolean; errors: RowError[]; template?: ParsedTemplate };
export type ImportPreview = {
  total: number;
  valid: number;
  invalid: number;
  duplicatesInFile: number;
  items: ImportItemResult[];
};

const VALID_TAX_RATES = new Set([0, 4, 10, 21]);
const VALID_CURRENCIES = new Set(["EUR", "USD"]);
const VALID_PAYMENT = new Set(["TRANSFER", "STRIPE", "REMITTANCE", "CARD", "CASH", "OTHER"]);
const MAX_ROWS = 5000;

/** Hash estable (djb2) del contenido normalizado → base36. Para dedupe/idempotencia. */
export function checksumOf(t: Omit<ParsedTemplate, "checksum" | "original" | "subtotalCents" | "taxCents" | "totalCents">): string {
  const norm = JSON.stringify({
    issuer: (t.issuerTaxId ?? t.issuerName ?? "").trim().toLowerCase(),
    client: (t.clientTaxId ?? t.clientName ?? "").trim().toLowerCase(),
    lines: t.lines.map((l) => [l.description?.trim().toLowerCase(), l.quantity, l.unitPriceCents, l.taxRate, l.discountPct ?? 0]),
    interval: t.intervalMonths,
    day: t.dayOfMonth,
    currency: t.currency
  });
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Convierte filas (agrupadas por externalId) en plantillas validadas. */
export function buildTemplates(rows: ImportRow[]): ImportItemResult[] {
  // Agrupa por externalId; si falta, cada fila es su propia plantilla (id sintético estable).
  const groups = new Map<string, ImportRow[]>();
  let synthetic = 0;
  for (const r of rows) {
    const ext = (r.externalId ?? r.externalid ?? r.id ?? "").trim();
    const key = ext || `row-${synthetic++}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const out: ImportItemResult[] = [];
  for (const [externalId, grp] of groups) {
    const errors: RowError[] = [];
    const head = grp[0];
    const num = (v: string | undefined, def?: number) => {
      const s = String(v ?? "").trim();
      if (s === "") return def; // vacío → default (Number("")===0 sería un bug)
      const n = Number(s.replace(",", "."));
      return Number.isFinite(n) ? n : def;
    };

    // Líneas (una por fila del grupo).
    const lines: InvoiceLine[] = [];
    grp.forEach((r, idx) => {
      const desc = sanitizeCell((r.description ?? r.concepto ?? "").trim());
      const qty = num(r.quantity ?? r.cantidad, 1)!;
      const unit = eurosToCents(r.unitPrice ?? r.precio ?? r.importe ?? "");
      const taxRate = num(r.taxRate ?? r.iva, 21)!;
      const discountPct = num(r.discountPct ?? r.descuento, 0)!;
      if (!desc) errors.push({ field: `lines[${idx}].description`, message: "Descripción vacía" });
      if (unit == null) errors.push({ field: `lines[${idx}].unitPrice`, message: "Importe no numérico" });
      if (!VALID_TAX_RATES.has(taxRate)) errors.push({ field: `lines[${idx}].taxRate`, message: `IVA no válido: ${taxRate}` });
      if (qty <= 0) errors.push({ field: `lines[${idx}].quantity`, message: "Cantidad debe ser > 0" });
      if (discountPct < 0 || discountPct > 100) errors.push({ field: `lines[${idx}].discountPct`, message: "Descuento fuera de 0-100" });
      lines.push({ description: desc, quantity: qty, unitPriceCents: unit ?? 0, taxRate, discountPct });
    });

    // Campos de plantilla (de la primera fila).
    const interval = num(head.intervalMonths ?? head.periodicidad, 1)!;
    const dayRaw = head.dayOfMonth ?? head.dia;
    const dayOfMonth = dayRaw ? num(dayRaw) ?? null : null;
    const currency = (head.currency ?? head.moneda ?? "EUR").trim().toUpperCase();
    const payment = (head.paymentMethod ?? head.metodoPago ?? "TRANSFER").trim().toUpperCase();
    const startDate = parseIsoDate(head.startDate ?? head.inicio);
    const endDate = parseIsoDate(head.endDate ?? head.fin);

    if (!Number.isInteger(interval) || interval < 1 || interval > 60) errors.push({ field: "intervalMonths", message: "Periodicidad debe ser 1-60 meses" });
    if (dayOfMonth != null && (dayOfMonth < 1 || dayOfMonth > 28)) errors.push({ field: "dayOfMonth", message: "Día debe ser 1-28 (fin de mes seguro)" });
    if (!VALID_CURRENCIES.has(currency)) errors.push({ field: "currency", message: `Moneda no soportada: ${currency}` });
    if (!VALID_PAYMENT.has(payment)) errors.push({ field: "paymentMethod", message: `Método de pago no válido: ${payment}` });
    if ((head.startDate ?? head.inicio) && !startDate) errors.push({ field: "startDate", message: "Fecha de inicio no válida" });
    if ((head.endDate ?? head.fin) && !endDate) errors.push({ field: "endDate", message: "Fecha de fin no válida" });
    if (startDate && endDate && endDate < startDate) errors.push({ field: "endDate", message: "La fecha de fin es anterior al inicio" });
    if (!(head.clientName ?? head.cliente ?? head.clientTaxId ?? head.nif)) errors.push({ field: "client", message: "Falta identificar el cliente (nombre o NIF)" });

    const totals = computeTotals(lines);
    const base = {
      externalId,
      issuerTaxId: (head.issuerTaxId ?? head.emisorNif ?? "").trim() || null,
      issuerName: sanitizeCell((head.issuerName ?? head.emisor ?? "").trim()) || null,
      clientName: sanitizeCell((head.clientName ?? head.cliente ?? "").trim()) || null,
      clientTaxId: (head.clientTaxId ?? head.nif ?? "").trim() || null,
      clientEmail: (head.clientEmail ?? head.email ?? "").trim() || null,
      lines,
      currency,
      intervalMonths: interval,
      dayOfMonth,
      startDate,
      endDate,
      paymentMethod: payment,
      series: (head.series ?? head.serie ?? "").trim() || null
    };
    const template: ParsedTemplate = {
      ...base,
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      checksum: checksumOf(base),
      original: grp
    };
    out.push({ externalId, ok: errors.length === 0, errors, template: errors.length === 0 ? template : undefined });
  }
  return out;
}

/** Punto de entrada: texto CSV → preview. */
export function previewCsv(text: string): ImportPreview {
  const grid = parseCsv(text);
  if (grid.length === 0) return { total: 0, valid: 0, invalid: 0, duplicatesInFile: 0, items: [] };
  const header = grid[0].map((h) => h.trim());
  const dataRows = grid.slice(1, 1 + MAX_ROWS);
  const rows: ImportRow[] = dataRows.map((cols) => {
    const r: ImportRow = {};
    header.forEach((h, i) => (r[h] = (cols[i] ?? "").trim()));
    return r;
  });
  return finalize(buildTemplates(rows));
}

/** Punto de entrada: array JSON → preview. */
export function previewJson(records: ImportRow[]): ImportPreview {
  const rows = records.slice(0, MAX_ROWS);
  return finalize(buildTemplates(rows));
}

function finalize(items: ImportItemResult[]): ImportPreview {
  // Duplicados DENTRO del fichero: mismo externalId+checksum aparece 2+ veces.
  const seen = new Map<string, number>();
  let dupes = 0;
  for (const it of items) {
    if (!it.template) continue;
    const k = `${it.externalId}|${it.template.checksum}`;
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    if (c > 1) dupes++;
  }
  return {
    total: items.length,
    valid: items.filter((i) => i.ok).length,
    invalid: items.filter((i) => !i.ok).length,
    duplicatesInFile: dupes,
    items
  };
}
