// Normaliza a E.164 sin "+" (formato que usa WAHA como chatId base).
// Si el valor ya es un chatId de WhatsApp (contiene "@", p.ej. "...@lid"),
// se devuelve tal cual: con el sistema LID de WhatsApp reconstruir el chatId
// desde el número NO enruta — hay que responder al chatId original.
export function normalizePhone(raw: string, defaultCountryCode = "34"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.includes("@")) return trimmed;
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!digits) return null;
  // Nueve dígitos → número nacional español (u otro país según prefijo configurado)
  if (digits.length === 9) digits = defaultCountryCode + digits;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

// Últimos 9 dígitos para casar números guardados con distintos prefijos.
export function last9(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-9);
}
