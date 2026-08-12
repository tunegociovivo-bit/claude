/**
 * Reconciliación de readiness (Slice E0) — lógica PURA (sin BD). SOLO comparación,
 * NO cambia nada: contrasta lo que el motor Hub PREVISUALIZARÍA (shadow previews)
 * contra lo que el sistema LEGADO ya emitió, por plantilla + periodo (YYYY-MM) +
 * importe. Sirve para juzgar si es seguro cortar (dual-run), sin activar nada.
 *
 * Join: la plantilla Hub backfilled lleva `externalId = "legacy:<legacyTemplateId>"`
 * y la factura legada lleva `recurringSourceId = <legacyTemplateId>`.
 */
export type HubPreview = { externalId: string | null; period: string; totalCents: number };
export type LegacyInvoice = { legacyTemplateId: string; period: string; totalCents: number };

export type CellStatus = "match" | "amount_mismatch" | "only_hub" | "only_legacy";
export type ReconCell = { key: string; templateKey: string; period: string; status: CellStatus; hubCents: number | null; legacyCents: number | null };

export type Readiness = "ready" | "review" | "not_ready";

export type ReconciliationReport = {
  totalCells: number;
  match: number;
  amountMismatch: number;
  onlyHub: number;
  onlyLegacy: number;
  matchRate: number; // 0..1 sobre celdas comparables (excluye only_hub informativos)
  readiness: Readiness;
  cells: ReconCell[];
};

/** "legacy:X" → "X"; cualquier otra cosa (CSV/HUB) → null (sin contraparte legada). */
export function legacyKeyOf(externalId: string | null | undefined): string | null {
  if (typeof externalId !== "string") return null;
  return externalId.startsWith("legacy:") ? externalId.slice("legacy:".length) : null;
}

/**
 * Reconcilia. Determinista. Empareja por (templateKey, period). `amount_mismatch`
 * cuando ambos existen pero difiere el importe; `only_legacy` = el Hub no lo
 * previó (riesgo de hueco al cortar); `only_hub` = preview sin factura legada
 * (informativo, p.ej. periodo futuro o plantilla no-legada).
 */
export function reconcile(hub: HubPreview[], legacy: LegacyInvoice[]): ReconciliationReport {
  const cells = new Map<string, ReconCell>();
  const keyOf = (tk: string, p: string) => `${tk}|${p}`;

  for (const h of hub) {
    const tk = legacyKeyOf(h.externalId);
    if (!tk) continue; // sin contraparte legada posible → no entra en la rejilla comparable
    const k = keyOf(tk, h.period);
    const cur = cells.get(k);
    cells.set(k, { key: k, templateKey: tk, period: h.period, status: "only_hub", hubCents: (cur?.hubCents ?? 0) + h.totalCents, legacyCents: cur?.legacyCents ?? null });
  }
  for (const l of legacy) {
    const k = keyOf(l.legacyTemplateId, l.period);
    const cur = cells.get(k);
    cells.set(k, { key: k, templateKey: l.legacyTemplateId, period: l.period, status: "only_legacy", hubCents: cur?.hubCents ?? null, legacyCents: (cur?.legacyCents ?? 0) + l.totalCents });
  }

  let match = 0,
    amountMismatch = 0,
    onlyHub = 0,
    onlyLegacy = 0;
  for (const c of cells.values()) {
    if (c.hubCents != null && c.legacyCents != null) {
      if (c.hubCents === c.legacyCents) {
        c.status = "match";
        match++;
      } else {
        c.status = "amount_mismatch";
        amountMismatch++;
      }
    } else if (c.hubCents != null) {
      c.status = "only_hub";
      onlyHub++;
    } else {
      c.status = "only_legacy";
      onlyLegacy++;
    }
  }

  // Comparables = todo lo que tiene contraparte legada (match + mismatch + only_legacy).
  const comparable = match + amountMismatch + onlyLegacy;
  const matchRate = comparable === 0 ? 1 : match / comparable;
  // Readiness: ready solo si NO hay diferencias de importe NI huecos (only_legacy).
  const readiness: Readiness = amountMismatch === 0 && onlyLegacy === 0 ? "ready" : amountMismatch > 0 ? "not_ready" : "review";

  const order: Record<CellStatus, number> = { amount_mismatch: 0, only_legacy: 1, only_hub: 2, match: 3 };
  const sorted = [...cells.values()].sort((a, b) => order[a.status] - order[b.status] || a.templateKey.localeCompare(b.templateKey) || a.period.localeCompare(b.period));

  return { totalCells: cells.size, match, amountMismatch, onlyHub, onlyLegacy, matchRate: Math.round(matchRate * 1000) / 1000, readiness, cells: sorted };
}

/** Periodo YYYY-MM (UTC) de una fecha. */
export function periodOf(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}
