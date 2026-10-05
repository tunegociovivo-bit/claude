// Utilidades de texto puras (sin BD) para la bandeja unificada: comparación de
// respuestas, detección de bajas, enlaces y huellas para envíos duplicados.

export function normalizeText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(value: string, minLength = 3): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((w) => w.length >= minLength);
}

function bigrams(value: string): Map<string, number> {
  const text = normalizeText(value).replace(/\s/g, "");
  const map = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

// Coeficiente de Dice sobre bigramas de caracteres: 1 = idéntico, 0 = nada en común.
// Tolera retoques pequeños (una coma, un emoji, una palabra cambiada).
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const count of ga.values()) total += count;
  for (const count of gb.values()) total += count;
  for (const [gram, count] of ga) overlap += Math.min(count, gb.get(gram) ?? 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

export type ReplyOutcome = "accepted" | "edited" | "rewritten" | "written" | "phone";

// Cómo se relaciona lo que envió una persona con lo que había propuesto la IA.
export function classifyReplyOutcome(
  aiDraft: string | null | undefined,
  finalText: string
): { outcome: Exclude<ReplyOutcome, "phone">; similarity: number | null } {
  if (!aiDraft || !aiDraft.trim()) return { outcome: "written", similarity: null };
  const score = similarity(aiDraft, finalText);
  if (score >= 0.97) return { outcome: "accepted", similarity: score };
  if (score >= 0.55) return { outcome: "edited", similarity: score };
  return { outcome: "rewritten", similarity: score };
}

const LINK_TLDS =
  "com|es|net|org|io|app|xyz|link|me|info|biz|co|shop|store|online|site|gg|to|ly|page|dev|club|eu|cat";
const LINK_RE = new RegExp(
  `(https?:\\/\\/\\S+|www\\.\\S+|\\b[a-z0-9-]+\\.(?:${LINK_TLDS})(?:\\/\\S*)?\\b)`,
  "i"
);

export function containsLink(text: string): boolean {
  return Boolean(text) && LINK_RE.test(text);
}

// Bajas explícitas (heredado del Hub): STOP, "baja", "no me escribas más"…
// Un "no me interesa" NO es una baja: el cliente puede volver a preguntar.
export function isOptOutMessage(value: string): boolean {
  const text = String(value ?? "").toLowerCase().trim();
  if (!text) return false;
  if (/^\s*(stop|unsubscribe|baja)\s*[.!]*\s*$/.test(text)) return true;
  if (/\bstop\b/.test(text) && text.length <= 40) return true;
  if (
    /\b(?:dame|dadme|denme|darme|darnos|solicito|solicitamos|quiero|queremos)\s+(?:(?:darme|darnos)\s+)?(?:de|la)\s+baja\b/.test(
      text
    )
  ) {
    return true;
  }
  if (/\bno\s+(?:quiero|queremos)\s+(?:recibir\s+)?(?:m[aá]s\s+)?mensajes\b/.test(text)) return true;
  if (
    /\bno\s+(?:me|nos)\s+(?:escribas|escrib[áa]is|escriban|contactes|contact[ée]is|contacten|mand[eé]is|mandes|env[ií]es)\s+(?:m[aá]s|nunca|de nuevo)\b/.test(
      text
    )
  ) {
    return true;
  }
  if (/\b(?:deja|dejad|dejen)\s+de\s+(?:escribir|escribirme|contactar|contactarme|mandar|enviar)\b/.test(text)) return true;
  // «No me escribas» a secas (mensaje corto, sin matiz de horario).
  return /^\s*(?:por favor,?\s*)?no\s+(?:me|nos)\s+(?:escribas|escrib[áa]is|escriban|contactes|contact[ée]is|mandes|mand[ée]is)(?:\s+(?:por favor|gracias))?\s*[.!]*\s*$/.test(text);
}

// Huella para detectar el mismo texto enviado a muchos chats (números → #).
export function bodyFingerprint(text: string): string {
  return normalizeText(text).replace(/\d+/g, "#").slice(0, 300);
}
