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

// ──────────────────────────────────────────────────────────────────
// Máquina de estados por tipo: qué estados puede usar cada tipo de
// documento y qué transiciones son legales. Evita incoherencias como un
// presupuesto "pagado" o resucitar una factura anulada.
// ──────────────────────────────────────────────────────────────────

const QUOTE_TYPES: InvoiceType[] = ["PRESUPUESTO", "PROFORMA"];

export function statusesForType(type: InvoiceType): InvoiceStatus[] {
  return QUOTE_TYPES.includes(type)
    ? ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "CANCELLED"]
    : ["DRAFT", "ISSUED", "PAID", "CANCELLED"];
}

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ["ISSUED", "SENT", "CANCELLED"],
  ISSUED: ["PAID", "CANCELLED"],
  PAID: ["ISSUED"], // deshacer un "pagada" por error sí se permite
  SENT: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["SENT"], // deshacer aceptación por error
  REJECTED: ["SENT"],
  CANCELLED: [] // una anulada no resucita (se emite rectificativa)
};

/** ¿Es legal pasar de `from` a `to` para un documento de tipo `type`? */
export function canTransition(type: InvoiceType, from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return true;
  const valid = statusesForType(type);
  if (!valid.includes(to)) return false;
  return (TRANSITIONS[from] ?? []).includes(to);
}

// ──────────────────────────────────────────────────────────────────
// Validadores fiscales/bancarios (España): IBAN (mod-97 ISO 13616) y
// NIF/NIE/CIF con dígito de control. Se usan al guardar emisores para
// que Facturae/SEPA no salgan con datos inválidos.
// ──────────────────────────────────────────────────────────────────

/** Valida un IBAN (cualquier país) con el checksum mod-97. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  // Mueve los 4 primeros caracteres al final y convierte letras a números
  // (A=10..Z=35); el resto módulo 97 debe ser 1. Se calcula incremental
  // para no desbordar Number.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= "0" && ch <= "9" ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

/** Valida NIF (DNI con letra), NIE o CIF español con dígito de control. */
export function isValidSpanishTaxId(raw: string): boolean {
  const v = raw.replace(/[\s-]/g, "").toUpperCase();
  const letters = "TRWAGMYFPDXBNJZSQVHLCKE";
  // NIF: 8 dígitos + letra de control.
  if (/^\d{8}[A-Z]$/.test(v)) return v[8] === letters[Number(v.slice(0, 8)) % 23];
  // NIE: X/Y/Z + 7 dígitos + letra (X→0, Y→1, Z→2).
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    const n = Number({ X: "0", Y: "1", Z: "2" }[v[0] as "X" | "Y" | "Z"] + v.slice(1, 8));
    return v[8] === letters[n % 23];
  }
  // CIF: letra de organización + 7 dígitos + control (dígito o letra).
  if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    const digits = v.slice(1, 8);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = Number(digits[i]);
      if (i % 2 === 0) {
        const dbl = d * 2;
        sum += dbl > 9 ? dbl - 9 : dbl;
      } else sum += d;
    }
    const control = (10 - (sum % 10)) % 10;
    const asLetter = "JABCDEFGHI"[control];
    // Según la letra inicial el control es número, letra o cualquiera.
    if ("PQRSNW".includes(v[0])) return v[8] === asLetter;
    if ("ABEH".includes(v[0])) return v[8] === String(control);
    return v[8] === String(control) || v[8] === asLetter;
  }
  return false;
}

/** Valida los datos fiscales/bancarios de un emisor. Devuelve el mensaje de
 *  error o null si todo es válido. El NIF/CIF solo se valida para España. */
export function issuerValidationError(data: {
  taxId?: string | null;
  iban?: string | null;
  countryCode?: string | null;
}): string | null {
  const country = (data.countryCode ?? "ESP").toUpperCase();
  if (data.taxId && (country === "ESP" || country === "ES") && !isValidSpanishTaxId(data.taxId)) {
    return `El NIF/CIF "${data.taxId}" no es válido (dígito de control incorrecto).`;
  }
  if (data.iban && !isValidIban(data.iban)) {
    return `El IBAN "${data.iban}" no es válido (checksum incorrecto).`;
  }
  return null;
}
