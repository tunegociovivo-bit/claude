const MENTION_ONLY_RE = /^(?:@[\p{L}\p{N}._-]+\s*)+$/u;
const WORD_RE = /[\p{L}\p{N}]+/gu;

const FILLER_WORDS = new Set([
  "aceituna",
  "aceitunas",
  "hola",
  "ok",
  "ole",
  "jaja",
  "jeje",
  "xd",
  "si",
  "sí",
  "no",
  "vale",
  "bien",
  "buenas",
]);

const OFF_TOPIC_HINTS = [
  /\baceitunas?\b/i,
  /\bpero siempre ser[aá]n un buen acompa[ñn]amiento\b/i,
];

export function isIrrelevantMetaComment(message: string | null | undefined) {
  const text = String(message ?? "").trim();
  if (!text) return true;
  if (MENTION_ONLY_RE.test(text)) return true;

  const words = [...text.matchAll(WORD_RE)].map((match) => match[0].toLocaleLowerCase("es-ES"));
  if (words.length === 0) return true;
  if (words.length <= 2 && words.every((word) => FILLER_WORDS.has(word))) return true;
  if (OFF_TOPIC_HINTS.some((pattern) => pattern.test(text)) && words.length <= 9) return true;

  return false;
}
