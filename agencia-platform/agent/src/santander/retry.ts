export type RemittanceRetryDecision = "RETRY" | "PAUSE";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Reintenta únicamente fallos de acceso/conexión que pueden ser transitorios.
 * OTP, CAPTCHA, datos ausentes y discrepancias requieren intervención inmediata.
 */
export function remittanceRetryDecision(reason: string, attempt: number, maxAttempts: number): RemittanceRetryDecision {
  if (attempt >= maxAttempts) return "PAUSE";
  const text = normalize(reason);
  const unsafeToRepeat = [
    "otp", "confirmacion movil", "captcha", "falta el usuario cifrado",
    "falta la credencial", "no se pudo usar la clave cifrada", "discrepancia",
    "no tiene configurado", "cambio de interfaz"
  ].some((token) => text.includes(token));
  if (unsafeToRepeat) return "PAUSE";
  const transient = [
    "ha rechazado el usuario o la clave local",
    "no completo el acceso automatico",
    "no se pudo conectar al chrome visible",
    "no detecto una sesion iniciada",
    "sesion ha sido cerrada",
    "sesion caducada"
  ].some((token) => text.includes(token));
  return transient ? "RETRY" : "PAUSE";
}

export function remittanceRetryDelayMs(attempt: number): number {
  return attempt <= 1 ? 15_000 : 45_000;
}
