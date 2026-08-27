const TRUSTED_OWNER_PHONES = new Set(["34680167881"]);

export function normalizeTrustedPhone(value: unknown): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = `34${digits}`;
  return digits;
}

/** Números personales autorizados explícitamente para ejecución sin aprobación. */
export function isTrustedOwnerPhone(value: unknown): boolean {
  return TRUSTED_OWNER_PHONES.has(normalizeTrustedPhone(value));
}
