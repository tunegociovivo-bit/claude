/** Normaliza teléfonos de negocio al formato internacional usado por WhatsApp. */
export function normalizeBusinessPhone(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9 && /^[6789]/.test(digits)) digits = `34${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  return `+${digits}`;
}
