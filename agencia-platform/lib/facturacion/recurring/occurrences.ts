/**
 * Cálculo PURO de ocurrencias de una plantilla recurrente (Slice C) — sin BD.
 *
 * Fechas como CALENDARIO (granularidad de día, no intradía) usando componentes
 * UTC para ser estable frente a DST/offset. Maneja meses cortos (recorte de día),
 * años bisiestos (29-feb), periodicidad y fecha de fin. Determinista.
 *
 * `timezone` se conserva en la plantilla como metadato de negocio (Europe/Madrid);
 * el cálculo es sobre componentes de fecha (día de emisión), así que no depende
 * del huso a nivel intradía.
 */
export type RecurrenceSpec = {
  anchorDate: Date; // fecha base (primera ocurrencia)
  intervalMonths: number; // >= 1
  dayOfMonth: number | null; // 1-28 preferido; null = día del anchor
  startDate: Date | null; // no antes de esto
  endDate: Date | null; // no después de esto
  nextIssueAt: Date | null; // próxima ocurrencia no generada (cursor)
};

/** Último día (1-31) del mes `monthIndex` (0-11) del año `year`, en UTC. */
export function lastDayOfMonthUTC(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Fecha (UTC, date-only) de la k-ésima ocurrencia desde el anchor. */
export function occurrenceAt(anchor: Date, k: number, intervalMonths: number, dayOfMonth: number | null): Date {
  const interval = Math.max(1, Math.floor(intervalMonths));
  const baseMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + k * interval;
  const targetYear = Math.floor(baseMonth / 12);
  const targetMonth = ((baseMonth % 12) + 12) % 12;
  const desiredDay = dayOfMonth != null ? dayOfMonth : anchor.getUTCDate();
  const clampedDay = Math.min(Math.max(1, desiredDay), lastDayOfMonthUTC(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}

const MAX_STEPS = 100_000; // salvaguarda dura contra bucles

/**
 * Ocurrencias en [start, end] (inclusive), hasta `cap`. Respeta endDate de la
 * plantilla. Monótona creciente desde el anchor.
 */
export function occurrencesBetween(spec: RecurrenceSpec, start: Date, end: Date, cap = 60): Date[] {
  const out: Date[] = [];
  const hardEnd = spec.endDate && spec.endDate.getTime() < end.getTime() ? spec.endDate.getTime() : end.getTime();
  const startMs = start.getTime();
  for (let k = 0; k < MAX_STEPS && out.length < cap; k++) {
    const d = occurrenceAt(spec.anchorDate, k, spec.intervalMonths, spec.dayOfMonth);
    const t = d.getTime();
    if (t > hardEnd) break;
    if (t >= startMs) out.push(d);
  }
  return out;
}

/** Efectivo inicio = max(startDate, anchor). */
function effectiveStart(spec: RecurrenceSpec): Date {
  if (spec.startDate && spec.startDate.getTime() > spec.anchorDate.getTime()) return spec.startDate;
  return spec.anchorDate;
}

/**
 * Ocurrencias DEBIDAS (para el motor shadow): desde el cursor (`nextIssueAt` o el
 * inicio efectivo) hasta `now`, con catch-up ACOTADO por `cap` (no reconstruye
 * años de histórico). Si la plantilla ya terminó (endDate < inicio), vacío.
 */
export function dueOccurrences(spec: RecurrenceSpec, now: Date, cap = 12): Date[] {
  const from = spec.nextIssueAt && spec.nextIssueAt.getTime() > effectiveStart(spec).getTime() ? spec.nextIssueAt : effectiveStart(spec);
  if (spec.endDate && spec.endDate.getTime() < from.getTime()) return [];
  return occurrencesBetween(spec, from, now, cap);
}

/** Primera ocurrencia estrictamente posterior a `after` (para "próxima emisión"). */
export function nextOccurrence(spec: RecurrenceSpec, after: Date): Date | null {
  const afterMs = after.getTime();
  for (let k = 0; k < MAX_STEPS; k++) {
    const d = occurrenceAt(spec.anchorDate, k, spec.intervalMonths, spec.dayOfMonth);
    if (spec.endDate && d.getTime() > spec.endDate.getTime()) return null;
    if (d.getTime() > afterMs) return d;
  }
  return null;
}

/** Clave de ocurrencia (date-only ISO) para idempotencia/anti doble-factura. */
export function occurrenceKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
