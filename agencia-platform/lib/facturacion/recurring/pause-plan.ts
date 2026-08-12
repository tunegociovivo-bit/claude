/**
 * Plan de PAUSA MASIVA de plantillas Hub (Slice D) — lógica PURA (sin BD).
 *
 * Genera la frase de confirmación FUERTE ligada al workspace + conteo exacto,
 * clasifica qué plantillas son pausables/reanudables, y valida la confirmación.
 * NO ejecuta nada: la ejecución (reversible) vive en la capa de persistencia y
 * está bloqueada tras esta confirmación + admin + A4 gate + flag opt-in.
 *
 * Anti CSV-injection reutilizado de import.ts para el inventario exportable.
 */
import { sanitizeCell } from "./import";

export type PauseAction = "pause" | "resume";

/** Estados sobre los que actúa cada acción (idempotente: lo demás se ignora). */
export const PAUSABLE_STATUSES = ["active", "draft"] as const; // se pueden pausar
export const RESUMABLE_STATUSES = ["paused"] as const; // se pueden reanudar

export function isPausable(status: string): boolean {
  return (PAUSABLE_STATUSES as readonly string[]).includes(status);
}
export function isResumable(status: string): boolean {
  return (RESUMABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Frase de confirmación fuerte. Ligada a: acción + conteo EXACTO + un token corto
 * del workspace (no copiable entre workspaces). Debe teclearse literal.
 *   p.ej. "PAUSAR 12 PLANTILLAS EN a1b2c3d4"
 */
export function expectedPhrase(action: PauseAction, count: number, workspaceId: string): string {
  const verb = action === "pause" ? "PAUSAR" : "REANUDAR";
  const token = String(workspaceId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
  return `${verb} ${count} PLANTILLAS EN ${token}`;
}

/** Comparación estricta (trim + colapso de espacios internos; case-sensitive en el verbo/token). */
export function phraseMatches(typed: string, expected: string): boolean {
  const norm = (s: string) => String(s ?? "").trim().replace(/\s+/g, " ");
  return norm(typed) === norm(expected);
}

export type TemplateStatusRow = { id: string; status: string; clientName?: string | null };

export type PausePlan = {
  action: PauseAction;
  requestedIds: string[];
  eligibleIds: string[]; // pausables/reanudables según la acción
  skipped: { id: string; reason: string }[]; // ya en estado objetivo / no elegibles / no encontrados
  count: number; // = eligibleIds.length → el conteo que va en la frase
  phrase: string; // frase esperada para este plan
};

/**
 * Construye el plan (dry-run puro): dada la selección explícita y el estado actual
 * de cada plantilla, calcula elegibles vs saltadas y la frase esperada.
 */
export function buildPausePlan(action: PauseAction, requestedIds: string[], rows: TemplateStatusRow[], workspaceId: string): PausePlan {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const eligibleIds: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const targetStatus = action === "pause" ? "paused" : "active";

  for (const id of requestedIds) {
    const r = byId.get(id);
    if (!r) {
      skipped.push({ id, reason: "no encontrada en el workspace" });
      continue;
    }
    if (r.status === targetStatus) {
      skipped.push({ id, reason: `ya está ${targetStatus}` });
      continue;
    }
    const ok = action === "pause" ? isPausable(r.status) : isResumable(r.status);
    if (!ok) {
      skipped.push({ id, reason: `estado ${r.status} no admite ${action}` });
      continue;
    }
    eligibleIds.push(id);
  }
  return {
    action,
    requestedIds,
    eligibleIds,
    skipped,
    count: eligibleIds.length,
    phrase: expectedPhrase(action, eligibleIds.length, workspaceId)
  };
}

/** Fila del inventario exportable (para el checklist manual de Holded). Saneada. */
export type InventoryRow = { clientName: string; totalCents: number; currency: string; intervalMonths: number; series: string; pausedInHolded: boolean };

/** CSV del inventario de activas (para pausar a mano en Holded). Anti-inyección. */
export function inventoryCsv(rows: InventoryRow[]): string {
  const header = ["cliente", "importe_eur", "moneda", "periodicidad_meses", "serie", "pausada_en_holded"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      sanitizeCell(r.clientName ?? ""),
      (r.totalCents / 100).toFixed(2),
      sanitizeCell(r.currency ?? "EUR"),
      String(r.intervalMonths ?? 1),
      sanitizeCell(r.series ?? ""),
      r.pausedInHolded ? "sí" : "no"
    ].map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c));
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}
