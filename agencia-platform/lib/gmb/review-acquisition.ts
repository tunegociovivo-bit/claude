/**
 * Review Acquisition — engine PURO y compliance. Genera enlaces/plantillas de captación de reseñas
 * con REGLAS DURAS:
 *   - Consentimiento OBLIGATORIO antes de enviar; opt-out respetado (suppression list).
 *   - Rate limits (no reenviar en ventana; tope por contacto).
 *   - PROHIBIDO review gating (nada de preguntar la valoración antes y desviar a los descontentos),
 *     incentivos ("gratis/descuento/regalo/sorteo a cambio") ni filtrado por sentimiento.
 * Sin red.
 */
import { createHash } from "node:crypto";

export function contactHash(value: string): string {
  return createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

/** Normaliza un contacto (email o teléfono) para hash/dedup. Devuelve null si no es válido. */
export function normalizeContact(input: { email?: string | null; phone?: string | null }): { kind: "email" | "phone"; value: string } | null {
  const email = (input.email ?? "").trim().toLowerCase();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { kind: "email", value: email };
  const phone = (input.phone ?? "").replace(/[^\d]/g, "");
  if (phone.length >= 9) return { kind: "phone", value: phone };
  return null;
}

export type SendGate = { consent: boolean; suppressed: boolean; lastSentAt?: string | Date | null; sentCount?: number };
export type SendDecision = { ok: boolean; reason?: string };

/** Decide si se puede enviar a un contacto. Consentimiento y no-supresión son obligatorios. */
export function canSend(gate: SendGate, opts: { minHoursBetween?: number; maxSends?: number; now?: Date } = {}): SendDecision {
  if (!gate.consent) return { ok: false, reason: "sin_consentimiento" };
  if (gate.suppressed) return { ok: false, reason: "suprimido" };
  const maxSends = opts.maxSends ?? 2;
  if ((gate.sentCount ?? 0) >= maxSends) return { ok: false, reason: "limite_reenvios" };
  if (gate.lastSentAt) {
    const now = opts.now ?? new Date();
    const hrs = (now.getTime() - new Date(gate.lastSentAt).getTime()) / 3_600_000;
    if (hrs < (opts.minHoursBetween ?? 72)) return { ok: false, reason: "rate_limit" };
  }
  return { ok: true };
}

/** Renderiza una plantilla multicanal sustituyendo variables. No añade incentivos. */
export function renderTemplate(template: string, vars: { nombre?: string; negocio?: string; enlace?: string; optout?: string }): string {
  return String(template ?? "")
    .replace(/\{nombre\}/gi, vars.nombre || "")
    .replace(/\{negocio\}/gi, vars.negocio || "")
    .replace(/\{enlace\}/gi, vars.enlace || "")
    .replace(/\{optout\}/gi, vars.optout || "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Patrones prohibidos por compliance (incentivos y review gating).
const INCENTIVE_RE = /\b(gratis|descuento|regalo|sorteo|premio|c[oó]digo|cup[oó]n|reembolso|te devolvemos)\b/i;
const GATING_RE = /\b(si (est[aá]s|quedaste) (contento|satisfecho)|solo si|solamente si|antes de valorar|c[oó]mo (ha ido|fue) tu experiencia\?)/i;

export type ComplianceCheck = { ok: boolean; issues: string[] };

/** Revisa una plantilla contra incentivos y review gating. */
export function checkCompliance(text: string): ComplianceCheck {
  const issues: string[] = [];
  if (INCENTIVE_RE.test(text)) issues.push("Posible INCENTIVO prohibido (no ofrezcas nada a cambio de una reseña).");
  if (GATING_RE.test(text)) issues.push("Posible REVIEW GATING (no condiciones ni filtres por satisfacción).");
  return { ok: issues.length === 0, issues };
}

/** Plantilla por defecto conforme (sin incentivos ni gating). */
export function defaultTemplate(): string {
  return "Hola {nombre}, gracias por confiar en {negocio}. Si te apetece, tu opinión nos ayuda mucho: deja una reseña aquí 👉 {enlace}. Si no quieres más mensajes: {optout}";
}
