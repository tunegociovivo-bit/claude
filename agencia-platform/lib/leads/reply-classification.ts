export function normalizedReply(text: string): string {
  return text.toLowerCase().trim();
}

function hasPositiveContrastOrTiming(text: string): boolean {
  return /\bpero\s+(?:s[ií]|quiero|queremos|me interesa|nos interesa|podemos|hablemos|ll[aá]m)/.test(text)
    || /\b(?:ahora|hoy|en este momento)\b[^.?!;]*(?:no|imposible)[^.?!;]*(?:ma[ñn]ana|luego|m[aá]s tarde|otro d[ií]a)/.test(text)
    || /\bno\s+(?:me|nos)\s+llam(?:es|[ée]is)\s+(?:ahora|hoy|en este momento)\b/.test(text)
    || /\b(?:ma[ñn]ana|luego|m[aá]s tarde|otro d[ií]a)\b[^.?!;]*(?:s[ií]|ll[aá]m|contact)/.test(text);
}

export function isOptOutReply(value: string): boolean {
  const text = normalizedReply(value);
  const explicitUnsubscribeCommand = /\bstop\b/.test(text)
    || /^\s*baja\b(?=\s*[,.;:!?]|\s*$)/.test(text)
    || /\b(?:dame|dadme|denme|darme|darnos|solicito|solicitamos|quiero|queremos)\s+(?:(?:darme|darnos)\s+)?(?:de|la)\s+baja\b/.test(text);
  const permanentOptOut = explicitUnsubscribeCommand
    || /\bno\s+(?:quiero|queremos)\s+(?:m[aá]s\s+)?mensajes\b/.test(text)
    || /\bno\s+(?:me|nos)\s+(?:escribas|escrib[áa]is|contactes|contact[ée]is|llames|llam[ée]is)\s+(?:m[aá]s|de nuevo|nunca)\b/.test(text)
    || /\b(?:deja|dejad|dejen)\s+de\s+(?:escribir|contactar|llamar)\b/.test(text);
  if (permanentOptOut) return true;
  if (hasPositiveContrastOrTiming(text)) return false;
  return /\bno\s+(?:me|nos)\s+(?:escribas|escrib[áa]is|contactes|contact[ée]is|llames|llam[ée]is)\b/.test(text);
}

export function isExplicitRejectionReply(value: string): boolean {
  const text = normalizedReply(value);
  if (hasPositiveContrastOrTiming(text)) return false;
  const directInterestRejection = /\b(?:no|tampoco)\s+(?:(?:me|nos)\s+)?interesa(?:n)?\b/.test(text);
  const shortTerminalRejection = /^(?:no|tampoco)\s+(?:quiero|queremos|necesito|necesitamos)\s*[.!?]*$/.test(text);
  const rejectedObject = /\b(?:no|tampoco)\s+(?:quiero|queremos|necesito|necesitamos)\s+(?:(?:mi|mis|su|sus|tu|tus|nuestro|nuestra|nuestros|nuestras|vuestro|vuestra|vuestros|vuestras|la|el|los|las|esta|este|ning[uú]n|ninguna|una?|más)\s+)*(?:servicios?|auditor[ií]a|propuesta|oferta|informaci[oó]n|marketing|posicionamiento|seo|nada)\b/.test(text);
  return directInterestRejection || shortTerminalRejection || rejectedObject
    || /\bno\s+(?:estoy|estamos)\s+interesad[oa]s?\b/.test(text)
    || /\b(?:sin|ning[uú]n)\s+inter[eé]s\b/.test(text)
    || /^(?:no\s+gracias|no\s+interesa|gracias\s+pero\s+no|de\s+momento\s+no)\s*[.!?]*$/.test(text);
}

/** Una respuesta que debe impedir cualquier contacto futuro por ambos canales. */
export function isPermanentNoContactReply(value: string): boolean {
  return isOptOutReply(value) || isExplicitRejectionReply(value);
}
