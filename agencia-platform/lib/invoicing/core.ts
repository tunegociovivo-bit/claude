/**
 * Núcleo del gestor de facturas: tipos, cálculo de totales y formato de
 * dinero. TODO el dinero se maneja en CÉNTIMOS enteros (nada de floats)
 * para evitar errores de redondeo. La divisa es por factura (EUR | USD).
 */

export const INVOICE_TYPES = ["NORMAL", "RECTIFICATIVA", "PROFORMA", "PRESUPUESTO"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const PAYMENT_METHODS = ["STRIPE", "TRANSFER", "REMITTANCE", "CARD", "CASH", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CURRENCIES = ["EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

// Estados válidos según el tipo. Las facturas usan ISSUED/PAID; los
// presupuestos usan SENT/ACCEPTED/REJECTED.
export const INVOICE_STATUSES = [
  "DRAFT",
  "ISSUED",
  "PAID",
  "CANCELLED",
  "SENT",
  "ACCEPTED",
  "REJECTED"
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRate: number; // % IVA (21, 10, 4, 0)
  discountPct?: number; // % descuento de la línea
};

export type TaxBreakdownRow = { rate: number; baseCents: number; taxCents: number };

export type InvoiceTotals = {
  subtotalCents: number; // base imponible (tras descuento)
  discountCents: number;
  taxCents: number;
  totalCents: number;
  taxBreakdown: TaxBreakdownRow[];
};

const r = Math.round;

/** Calcula los totales de una factura a partir de sus líneas. */
export function computeTotals(lines: InvoiceLine[]): InvoiceTotals {
  let subtotalCents = 0;
  let discountCents = 0;
  const byRate = new Map<number, { baseCents: number; taxCents: number }>();

  for (const ln of lines) {
    const qty = Number(ln.quantity) || 0;
    const unit = Math.round(Number(ln.unitPriceCents) || 0);
    const rate = Number(ln.taxRate) || 0;
    const disc = Math.min(Math.max(Number(ln.discountPct) || 0, 0), 100);

    const gross = r(qty * unit);
    const lineDiscount = r((gross * disc) / 100);
    const net = gross - lineDiscount;
    const lineTax = r((net * rate) / 100);

    subtotalCents += net;
    discountCents += lineDiscount;

    const acc = byRate.get(rate) ?? { baseCents: 0, taxCents: 0 };
    acc.baseCents += net;
    acc.taxCents += lineTax;
    byRate.set(rate, acc);
  }

  const taxBreakdown: TaxBreakdownRow[] = [...byRate.entries()]
    .map(([rate, v]) => ({ rate, baseCents: v.baseCents, taxCents: v.taxCents }))
    .sort((a, b) => b.rate - a.rate);

  const taxCents = taxBreakdown.reduce((s, t) => s + t.taxCents, 0);
  const totalCents = subtotalCents + taxCents;

  return { subtotalCents, discountCents, taxCents, totalCents, taxBreakdown };
}

const CURRENCY_SYMBOL: Record<Currency, string> = { EUR: "€", USD: "$" };

/** Formatea céntimos a string con la divisa (formato es-ES). */
export function formatMoney(cents: number, currency: Currency | string = "EUR"): string {
  const cur = (currency in CURRENCY_SYMBOL ? currency : "EUR") as Currency;
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: cur }).format(
      (cents || 0) / 100
    );
  } catch {
    return `${((cents || 0) / 100).toFixed(2)} ${CURRENCY_SYMBOL[cur] ?? cur}`;
  }
}

/** "21" → "21%", admite decimales. */
export function formatRate(rate: number): string {
  return `${Number(rate).toLocaleString("es-ES")}%`;
}

/** Devuelve la serie por defecto para un tipo de factura. */
export function defaultSeriesForType(type: InvoiceType): string {
  switch (type) {
    case "RECTIFICATIVA":
      return "REC";
    case "PROFORMA":
      return "PRO";
    case "PRESUPUESTO":
      return "PRE";
    default:
      return "FAC";
  }
}

export const TYPE_LABEL: Record<InvoiceType, string> = {
  NORMAL: "Factura",
  RECTIFICATIVA: "Factura rectificativa",
  PROFORMA: "Factura proforma",
  PRESUPUESTO: "Presupuesto"
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  STRIPE: "Stripe",
  TRANSFER: "Transferencia bancaria",
  REMITTANCE: "Remesa bancaria (SEPA)",
  CARD: "Tarjeta",
  CASH: "Efectivo",
  OTHER: "Otro"
};

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  ISSUED: "Emitida",
  PAID: "Pagada",
  CANCELLED: "Anulada",
  SENT: "Enviado",
  ACCEPTED: "Aceptado",
  REJECTED: "Rechazado"
};
