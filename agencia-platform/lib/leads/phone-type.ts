/**
 * Detección de tipo de teléfono español para saber si es contactable por
 * WhatsApp. En España los MÓVILES empiezan por 6 o 7 (9 dígitos); los FIJOS
 * por 8 o 9. WhatsApp Business sí existe en algún fijo, pero la inmensa mayoría
 * de cuentas están en móviles, así que filtrar por móvil reduce muchísimo la
 * "cola muerta" (números que nunca recibirán el mensaje).
 */

export type PhoneKind = "mobile" | "landline" | "unknown";

/** Normaliza a dígitos nacionales (9) si es un número español; null si no. */
function spanishNationalDigits(input?: string | null): string | null {
  if (!input) return null;
  let d = input.replace(/[^\d+]/g, "");
  if (d.startsWith("+34")) d = d.slice(3);
  else if (d.startsWith("0034")) d = d.slice(4);
  else if (d.startsWith("34") && d.replace(/\D/g, "").length === 11) d = d.slice(2);
  d = d.replace(/\D/g, "");
  return d.length === 9 ? d : null;
}

export function phoneKind(phone?: string | null, intlPhone?: string | null): PhoneKind {
  const d = spanishNationalDigits(intlPhone) ?? spanishNationalDigits(phone);
  if (!d) return "unknown"; // sin número o no es español de 9 dígitos
  const first = d[0];
  if (first === "6" || first === "7") return "mobile";
  if (first === "8" || first === "9") return "landline";
  return "unknown";
}

/** ¿Es razonablemente contactable por WhatsApp? Móvil sí; desconocido (p. ej.
 *  número extranjero) lo dejamos pasar; fijo no. */
export function isWhatsappReachable(phone?: string | null, intlPhone?: string | null): boolean {
  return phoneKind(phone, intlPhone) !== "landline";
}
