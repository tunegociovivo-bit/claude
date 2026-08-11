/**
 * Lógica de presentación PURA de la bandeja de excepciones (FASE 4b · UI).
 * Sin React → testeable. No inventa estados: el nivel A0–A4 se DERIVA de forma
 * determinista del `kind` (que es un estado real del motor de Fase 4a).
 */
import type { ExceptionItem, ExceptionKind, Severity, ExceptionSource } from "./engine";

export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4";

/**
 * Autonomía que SONIA tiene sobre este tipo de excepción (determinista):
 *   approval_pending  → A4, requiere aprobación (SONIA preparó, espera tu OK).
 *   billing_problem   → A2 (puede preparar un recordatorio/borrador; el envío
 *                       necesitaría aprobación).
 *   message_unresolved/sla_breached → A1 (SONIA retomará al responder; no ejecuta).
 *   automation_failed / task_blocked → A0 (SONIA no actúa; es cosa tuya).
 * NUNCA sugiere que algo se ejecutó.
 */
export function autonomyForKind(kind: ExceptionKind): { level: AutonomyLevel; requiresApproval: boolean; label: string } {
  switch (kind) {
    case "approval_pending":
      return { level: "A4", requiresApproval: true, label: "Requiere tu aprobación" };
    case "billing_problem":
      return { level: "A2", requiresApproval: true, label: "SONIA puede preparar un borrador" };
    case "message_unresolved":
    case "sla_breached":
      return { level: "A1", requiresApproval: false, label: "SONIA espera tu respuesta" };
    case "automation_failed":
    case "task_blocked":
    default:
      return { level: "A0", requiresApproval: false, label: "Sin acción autónoma" };
  }
}

export const SOURCE_LABEL: Record<ExceptionSource, string> = {
  ai_draft: "Borrador de SONIA",
  ai_run: "Ejecución de SONIA",
  invoice: "Facturación",
  task: "Tarea",
  lead_inbox: "Bandeja de leads",
  cron: "Automatización programada"
};

export const KIND_LABEL: Record<ExceptionKind, string> = {
  approval_pending: "Aprobación pendiente",
  automation_failed: "Automatización fallida",
  sla_breached: "SLA vencido",
  billing_problem: "Cobro/factura",
  message_unresolved: "Mensaje sin resolver",
  task_blocked: "Tarea bloqueada"
};

export function severityMeta(sev: Severity): { label: string; badge: string; dot: string } {
  switch (sev) {
    case "critical":
      return { label: "Crítica", badge: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" };
    case "high":
      return { label: "Alta", badge: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" };
    case "medium":
      return { label: "Media", badge: "bg-sky-50 text-sky-700 border-sky-200", dot: "bg-sky-500" };
    default:
      return { label: "Baja", badge: "bg-slate-50 text-slate-600 border-slate-200", dot: "bg-slate-400" };
  }
}

/** Antigüedad legible (es-ES) a partir de ms. */
export function formatAge(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return m <= 1 ? "hace 1 min" : `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "hace 1 h" : `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

/** Enlace SEGURO: solo rutas internas relativas ("/..."); cualquier otra cosa
 *  (absoluta, protocolo, //host, javascript:) se descarta a null → no navegable. */
export function safeLink(link: string | null | undefined): string | null {
  if (typeof link !== "string") return null;
  const l = link.trim();
  // Solo rutas internas: empieza por "/" pero no "//" ni "/\" (los navegadores
  // normalizan "\"→"/", así "/\evil" se volvería "//evil" = host externo).
  if (!/^\/[^/\\]/.test(l)) return null;
  if (l.includes("\\")) return null;
  if (/[\x00-\x1f]/.test(l)) return null;
  return l;
}

export type UiFilters = { severity?: Severity | "all"; source?: ExceptionSource | "all"; q?: string };

/** Filtro + búsqueda en cliente sobre los ítems ya cargados (orden preservado). */
export function filterItems(items: ExceptionItem[], f: UiFilters): ExceptionItem[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return items.filter((it) => {
    if (f.severity && f.severity !== "all" && it.severity !== f.severity) return false;
    if (f.source && f.source !== "all" && it.source !== f.source) return false;
    if (q) {
      const hay = `${it.title} ${it.detail} ${it.needsFromMe}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ── Ocultar localmente (reversible, sin servidor) ──
// Clave por id + SEVERIDAD: si la incidencia escala (p.ej. media→crítica), la
// clave cambia y VUELVE A APARECER (no se esconde una versión más grave).
export function dismissKey(item: Pick<ExceptionItem, "id" | "severity">): string {
  return `${item.id}|${item.severity}`;
}
const DISMISS_KEY = "exceptions.dismissed.v1";
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
export function loadDismissed(store: KV | null | undefined): string[] {
  if (!store) return [];
  try {
    const raw = store.getItem(DISMISS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function toggleDismissed(store: KV | null | undefined, id: string): string[] {
  const cur = loadDismissed(store);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  try {
    store?.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch {
    // sin storage: se mantiene en memoria de la sesión
  }
  return next;
}
