/**
 * Acciones sobre excepciones (Slice 2b) — lógica PURA (sin BD, sin React).
 *
 * Persistencia idempotente y auditada del "ocultar/archivar/ignorar/posponer"
 * que antes solo vivía en localStorage. Aquí van: validación de la acción, cómo
 * se decide si una acción persistida sigue "viva", y el filtrado de la bandeja.
 */
import type { ExceptionItem } from "./engine";

/** Acciones soportadas. Las tres primeras OCULTAN el ítem de la vista activa
 *  (reversibles/caducables). reschedule/assign/cleanup_batch describen una
 *  intención de dominio (el cambio real se audita aparte). */
export const EXCEPTION_ACTION_TYPES = ["archive", "ignore", "snooze", "reschedule", "assign", "cleanup_batch"] as const;
export type ExceptionActionType = (typeof EXCEPTION_ACTION_TYPES)[number];

/** Acciones que ocultan el ítem de la vista activa mientras estén vivas. */
export const HIDING_ACTIONS = new Set<ExceptionActionType>(["archive", "ignore", "snooze"]);

export function isActionType(v: unknown): v is ExceptionActionType {
  return typeof v === "string" && (EXCEPTION_ACTION_TYPES as readonly string[]).includes(v);
}

/** `${source}:${rowId}` — la identidad estable de una excepción (engine.ts). */
export function parseExceptionId(exceptionId: string): { source: string; rowId: string } | null {
  const i = exceptionId.indexOf(":");
  if (i <= 0 || i === exceptionId.length - 1) return null;
  return { source: exceptionId.slice(0, i), rowId: exceptionId.slice(i + 1) };
}

export type PersistedAction = {
  exceptionId: string;
  action: string;
  severity?: string | null;
  expiresAt?: Date | string | null;
  revokedAt?: Date | string | null;
};

const ms = (d: Date | string | null | undefined): number | null => {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isFinite(t) ? t : null;
};

/** Una acción está "viva" si no está revocada y no ha caducado. */
export function isLive(a: PersistedAction, now: Date): boolean {
  if (ms(a.revokedAt) != null) return false;
  const exp = ms(a.expiresAt);
  if (exp != null && exp <= now.getTime()) return false;
  return true;
}

/**
 * Clave de ocultación: id + severidad. Si la excepción ESCALA (media→crítica), la
 * severidad cambia y la acción de ocultar ya NO aplica → re-aparece (misma
 * política que el dismiss local previo, ahora server-side).
 */
export function hideKey(exceptionId: string, severity: string | null | undefined): string {
  return `${exceptionId}|${severity ?? ""}`;
}

/** Conjunto de claves ocultas vivas (solo acciones que ocultan). */
export function liveHiddenKeys(actions: PersistedAction[], now: Date): Set<string> {
  const set = new Set<string>();
  for (const a of actions) {
    if (!isActionType(a.action) || !HIDING_ACTIONS.has(a.action)) continue;
    if (!isLive(a, now)) continue;
    set.add(hideKey(a.exceptionId, a.severity ?? null));
  }
  return set;
}

/** Filtra de la bandeja los ítems con una acción de ocultar viva para su
 *  severidad actual. Si la severidad cambió, la ocultación no aplica. */
export function applyHidden(items: ExceptionItem[], actions: PersistedAction[], now: Date): ExceptionItem[] {
  const hidden = liveHiddenKeys(actions, now);
  if (hidden.size === 0) return items;
  return items.filter((it) => !hidden.has(hideKey(it.id, it.severity)));
}

/** Normaliza/valida el payload entrante del endpoint (defensivo). */
export type ActionInput = {
  exceptionId: string;
  dedupeKey: string;
  source: string;
  kind: string;
  action: ExceptionActionType;
  reason?: string | null;
  severity?: string | null;
  expiresAt?: string | null;
  meta?: unknown;
};

export function validateActionInput(raw: any): { ok: true; value: ActionInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "payload inválido" };
  const exceptionId = typeof raw.exceptionId === "string" ? raw.exceptionId.trim() : "";
  if (!exceptionId || !parseExceptionId(exceptionId)) return { ok: false, error: "exceptionId inválido" };
  if (!isActionType(raw.action)) return { ok: false, error: "action no soportada" };
  const dedupeKey = typeof raw.dedupeKey === "string" && raw.dedupeKey.trim() ? raw.dedupeKey.trim() : exceptionId;
  const source = typeof raw.source === "string" ? raw.source.trim() : parseExceptionId(exceptionId)!.source;
  const kind = typeof raw.kind === "string" ? raw.kind.trim() : "";
  const reason = typeof raw.reason === "string" ? raw.reason.slice(0, 500) : null;
  const severity = typeof raw.severity === "string" ? raw.severity.slice(0, 20) : null;
  // expiresAt: ISO válido y futuro, o null.
  let expiresAt: string | null = null;
  if (raw.expiresAt != null) {
    const t = Date.parse(String(raw.expiresAt));
    if (!Number.isFinite(t)) return { ok: false, error: "expiresAt inválido" };
    expiresAt = new Date(t).toISOString();
  }
  return { ok: true, value: { exceptionId, dedupeKey, source, kind, action: raw.action, reason, severity, expiresAt, meta: raw.meta ?? null } };
}
