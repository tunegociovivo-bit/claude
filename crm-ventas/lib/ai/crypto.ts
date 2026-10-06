// Adaptador para el código portado del Hub: mismo contrato (decrypt devuelve
// null si no puede descifrar) sobre el cifrado del CRM (ENCRYPTION_KEY).
import { encryptSecret as crmEncrypt, decryptSecret as crmDecrypt } from "@/lib/crypto";

export function encryptSecret(plain: string): string {
  return crmEncrypt(plain);
}

export function decryptSecret(payload: string): string | null {
  if (!payload) return null;
  try {
    return crmDecrypt(payload);
  } catch {
    return null;
  }
}

export function maskSecret(token: string): string {
  if (!token) return "";
  if (token.length <= 12) return "•••";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}
