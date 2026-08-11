/**
 * Backfill del legado `Invoice.recurring` → `RecurringInvoiceTemplate` (Slice B)
 * — mapeo PURO (sin BD). Idempotente y NO destructivo: no toca las facturas
 * legadas ni el motor legado (sigue generando); solo produce plantillas `draft`
 * en la tabla nueva, con `source=LEGACY_INVOICE` y `externalId=legacy:<id>`.
 *
 * `status:"draft"` a propósito: durante la transición el legado sigue siendo la
 * fuente de verdad; las plantillas backfilled NO se activan (evita doble emisión).
 * El corte (activar Hub + desactivar legado) es un slice posterior (E), no aquí.
 */
export type LegacyInvoiceRow = {
  id: string;
  workspaceId: string;
  type: string;
  series: string | null;
  issuerId: string | null;
  clientId: string | null;
  issuerSnapshot: unknown;
  clientSnapshot: unknown;
  currency: string;
  paymentMethod: string;
  lines: unknown;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  issueDate: Date | string | null;
  recurrenceConfig: unknown;
};

export type BackfillConflict = { code: string; message: string };

export type BackfillTemplateData = {
  workspaceId: string;
  source: "LEGACY_INVOICE";
  externalId: string;
  status: "draft";
  issuerId: string | null;
  clientId: string | null;
  issuerSnapshot: unknown;
  clientSnapshot: unknown;
  lines: unknown;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  intervalMonths: number;
  dayOfMonth: number | null;
  anchorDate: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  nextIssueAt: Date | null;
  paymentMethod: string;
  sepa: boolean;
  series: string | null;
  originalSnapshot: unknown;
  checksum: string;
};

export type BackfillItem = {
  legacyInvoiceId: string;
  externalId: string;
  ok: boolean;
  conflicts: BackfillConflict[];
  clientName: string | null;
  data?: BackfillTemplateData;
};

function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const dateOnly = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : "");

/** Checksum estable del contenido mapeado (dedupe/idempotencia dentro del source). */
export function backfillChecksum(d: Omit<BackfillTemplateData, "checksum">): string {
  const cs = (d.clientSnapshot as any) ?? {};
  const norm = JSON.stringify({
    client: String(cs.taxId ?? cs.name ?? d.clientId ?? "").trim().toLowerCase(),
    lines: Array.isArray(d.lines) ? (d.lines as any[]).map((l) => [String(l?.description ?? "").trim().toLowerCase(), l?.quantity, l?.unitPriceCents, l?.taxRate, l?.discountPct ?? 0]) : [],
    interval: d.intervalMonths,
    day: d.dayOfMonth,
    currency: d.currency,
    payment: d.paymentMethod,
    series: d.series ?? "",
    total: d.totalCents,
    start: dateOnly(d.startDate),
    end: dateOnly(d.endDate)
  });
  return stableHash(norm);
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Mapea una factura-plantilla legada a datos de RecurringInvoiceTemplate. */
export function mapLegacy(row: LegacyInvoiceRow): BackfillItem {
  const conflicts: BackfillConflict[] = [];
  const cfg = (row.recurrenceConfig as any) ?? {};
  const externalId = `legacy:${row.id}`;
  const clientSnap = (row.clientSnapshot as any) ?? null;
  const clientName = clientSnap?.name ?? null;

  // NORMALIZACIÓN espejo del motor legado (recurring.ts): NO son conflictos —
  // estas plantillas están HOY generando facturas reales, así que deben migrar.
  //  - interval faltante/0/NaN → 1 (mensual), como Math.max(1, x||1).
  //  - dayOfMonth 29-31 → se acota a 28 (fin de mes seguro, como addMonths).
  const rawInterval = Math.floor(Number(cfg.intervalMonths));
  const intervalMonths = Number.isFinite(rawInterval) && rawInterval >= 1 ? Math.min(120, rawInterval) : 1;
  const rawDay = cfg.dayOfMonth == null || cfg.dayOfMonth === "" ? null : Math.floor(Number(cfg.dayOfMonth));
  const dayOfMonth = rawDay == null || !Number.isFinite(rawDay) ? null : Math.min(28, Math.max(1, rawDay));
  const nextIssueAt = toDate(cfg.nextRunAt) ?? toDate(row.issueDate);
  const endDate = toDate(cfg.endsAt);
  const anchor = toDate(row.issueDate);
  const lines = Array.isArray(row.lines) ? row.lines : [];

  // Conflictos REALES (se reportan y NO se importa la fila): datos rotos, no
  // periodicidades normalizables.
  if (lines.length === 0) conflicts.push({ code: "no_lines", message: "La plantilla legada no tiene líneas" });
  if (!row.clientId && !clientSnap) conflicts.push({ code: "no_client", message: "Sin cliente identificable" });
  if (endDate && anchor && endDate < anchor) conflicts.push({ code: "end_before_start", message: "La fecha de fin es anterior al inicio" });

  const base: Omit<BackfillTemplateData, "checksum"> = {
    workspaceId: row.workspaceId,
    source: "LEGACY_INVOICE",
    externalId,
    status: "draft",
    issuerId: row.issuerId,
    clientId: row.clientId,
    issuerSnapshot: row.issuerSnapshot ?? null,
    clientSnapshot: row.clientSnapshot ?? null,
    lines,
    currency: row.currency,
    subtotalCents: row.subtotalCents,
    taxCents: row.taxCents,
    totalCents: row.totalCents,
    intervalMonths,
    dayOfMonth,
    anchorDate: anchor,
    startDate: anchor,
    endDate,
    nextIssueAt,
    paymentMethod: row.paymentMethod ?? "TRANSFER",
    sepa: row.paymentMethod === "REMITTANCE",
    series: row.series ?? null,
    originalSnapshot: { legacyInvoiceId: row.id, recurrenceConfig: cfg, type: row.type }
  };

  return {
    legacyInvoiceId: row.id,
    externalId,
    ok: conflicts.length === 0,
    conflicts,
    clientName,
    data: conflicts.length === 0 ? { ...base, checksum: backfillChecksum(base) } : undefined
  };
}

export type BackfillReport = {
  total: number;
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  conflicts: number;
  items: { legacyInvoiceId: string; externalId: string; action: "create" | "update" | "unchanged" | "conflict"; clientName: string | null; conflicts: BackfillConflict[] }[];
};
