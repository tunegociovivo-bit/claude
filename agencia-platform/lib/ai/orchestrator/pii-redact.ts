/**
 * Minimización de PII antes de entregar texto a un proveedor de modelo (Slice
 * 2c.2) — PURO y determinista. Se aplica SIEMPRE antes de "enviar" (incluso en
 * shadow, donde no se llama a nadie), para que ni siquiera la simulación registre
 * PII. Reemplaza por marcadores y cuenta las redacciones (trazabilidad).
 *
 * No pretende ser exhaustivo (imposible), sino minimizar: emails, teléfonos, NIF/
 * NIE/CIF, IBAN, tarjetas y valores de secretos conocidos.
 */
export type RedactionResult = { text: string; count: number; kinds: Record<string, number> };

// Orden importa: los patrones más específicos primero (IBAN antes que "número").
const PATTERNS: { kind: string; rx: RegExp; token: string }[] = [
  { kind: "secret", rx: /\b(sk-[A-Za-z0-9]{20,}|EAA[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g, token: "«SECRETO»" },
  { kind: "email", rx: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, token: "«EMAIL»" },
  { kind: "iban", rx: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Za-z0-9]){11,30}\b/g, token: "«IBAN»" },
  { kind: "card", rx: /\b(?:\d[ -]?){13,19}\b/g, token: "«TARJETA»" },
  // NIF/NIE/CIF español (aprox): 8 dígitos + letra, o letra + 7 dígitos + letra/dígito.
  { kind: "nif", rx: /\b(?:[XYZ]?\d{7,8}[A-HJ-NP-TV-Z]|[A-HJ-NP-SUVW]\d{7}[0-9A-J])\b/gi, token: "«NIF»" },
  // Teléfono ES (+34 opcional, 9 dígitos empezando por 6/7/8/9), con separadores.
  { kind: "phone", rx: /(?:\+34[ -]?)?[6-9]\d{2}[ -]?\d{2}[ -]?\d{2}[ -]?\d{2}\b/g, token: "«TEL»" }
];

/** Redacta PII y devuelve el texto saneado + conteo por tipo. Determinista. */
export function redactPii(input: string | null | undefined): RedactionResult {
  let text = typeof input === "string" ? input : "";
  const kinds: Record<string, number> = {};
  let count = 0;
  for (const { kind, rx, token } of PATTERNS) {
    text = text.replace(rx, () => {
      count++;
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      return token;
    });
  }
  return { text, count, kinds };
}

/** Redacta una lista de mensajes {role, content}, preservando el tipo del rol. */
export function redactMessages<T extends { role: string; content: string }>(messages: T[]): { messages: T[]; count: number } {
  let count = 0;
  const out = messages.map((m) => {
    const r = redactPii(m.content);
    count += r.count;
    return { ...m, content: r.text };
  });
  return { messages: out, count };
}
