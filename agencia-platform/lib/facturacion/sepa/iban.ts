/**
 * Enmascarado de IBAN. NUNCA se persiste el IBAN completo: solo la máscara.
 */
export function maskIban(ibanRaw: string): string | null {
  const iban = ibanRaw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return null; // formato IBAN básico
  const head = iban.slice(0, 4);
  const tail = iban.slice(-4);
  const middle = "*".repeat(Math.max(0, iban.length - 8));
  // Agrupa de 4 en 4 para legibilidad.
  return `${head}${middle}${tail}`.replace(/(.{4})/g, "$1 ").trim();
}
