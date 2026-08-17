/**
 * Tokens de informe compartible (white-label). El token en claro se muestra UNA vez al crear; en la
 * BD solo se guarda su HASH (sha256). Validación por expiración/revocación. Puro (crypto local).
 */
import { randomBytes, createHash } from "node:crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** Genera un token aleatorio (url-safe) y su hash para guardar. */
export function generateShareToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

export type ShareRecord = { expiresAt: string | Date; revokedAt?: string | Date | null };
export function isShareValid(share: ShareRecord, now: Date = new Date()): { valid: boolean; reason?: string } {
  if (share.revokedAt) return { valid: false, reason: "revoked" };
  if (new Date(share.expiresAt).getTime() < now.getTime()) return { valid: false, reason: "expired" };
  return { valid: true };
}

/** Fecha de expiración por días (por defecto 30). */
export function expiryFromDays(days = 30, now: Date = new Date()): Date {
  const d = Math.max(1, Math.min(days, 365));
  return new Date(now.getTime() + d * 24 * 3600 * 1000);
}

/** Redacta PII del informe si includePII es false (por defecto). Devuelve una copia segura. */
export function redactReportForShare(report: any, includePII: boolean): any {
  if (includePII) return report;
  const safe = JSON.parse(JSON.stringify(report ?? {}));
  // El informe de crecimiento ya es agregado; por seguridad quitamos dirección exacta.
  if (safe.client) delete safe.client.address;
  return safe;
}
