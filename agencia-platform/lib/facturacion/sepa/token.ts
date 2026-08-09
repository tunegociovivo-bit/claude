/**
 * Token de aprobación de remesa SEPA — de UN SOLO USO.
 *
 * Seguridad: el token en claro solo viaja en el email (enlace). En BD guardamos
 * ÚNICAMENTE su hash SHA-256. La búsqueda es por hash (índice único) y la
 * comparación se hace en tiempo constante (timingSafeEqual) para no filtrar
 * información por el tiempo de respuesta.
 */
import { randomBytes, createHash, timingSafeEqual } from "crypto";

/** Genera un token aleatorio (256 bits, base64url) y su hash para guardar. */
export function generateApprovalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** Hash SHA-256 (hex) del token. Es lo ÚNICO que se persiste. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Comparación en tiempo constante de dos hashes hex. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Caducidad por defecto del token: 24 h. */
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
