import { z } from "zod";

/**
 * Conversación en comentarios entre varias cuentas reales de la granja.
 * Cada mensaje es un trabajo independiente en la cola de su móvil: la persona
 * titular de esa cuenta lo revisa, lo edita si quiere y lo aprueba. Una
 * respuesta solo se publica cuando el mensaje al que responde ya está publicado.
 */
export const MAX_THREAD_MESSAGES = 20;
export const MAX_THREAD_PARTICIPANTS = 20;
export const MAX_THREAD_TEXT = 1200;

export const threadMessageOutcomeSchema = z.enum(["pending", "sent", "review", "failed"]);

export const commentThreadMessageSchema = z.object({
  kind: z.literal("comment_thread"),
  version: z.literal(1),
  threadId: z.string().uuid(),
  order: z.number().int().min(1).max(MAX_THREAD_MESSAGES),
  total: z.number().int().min(1).max(MAX_THREAD_MESSAGES),
  postUrl: z.string().url().max(2048),
  guide: z.string().trim().max(2000),
  author: z.string().trim().min(1).max(120),
  mode: z.enum(["comment", "reply"]),
  replyToOrder: z.number().int().min(1).max(MAX_THREAD_MESSAGES).nullable(),
  replyToAuthor: z.string().trim().max(120).nullable(),
  replyToText: z.string().trim().max(MAX_THREAD_TEXT).nullable(),
  parentJobId: z.string().max(100).nullable(),
  previousJobId: z.string().max(100).nullable(),
  text: z.string().trim().min(2).max(MAX_THREAD_TEXT),
  outcome: threadMessageOutcomeSchema,
  detail: z.string().trim().max(500).nullable()
}).strict().superRefine((value, context) => {
  if (value.mode === "reply" && (!value.replyToOrder || value.replyToOrder >= value.order)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["replyToOrder"], message: "Una respuesta debe apuntar a un mensaje anterior." });
  }
  if (value.mode === "comment" && value.replyToOrder !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["replyToOrder"], message: "Un comentario nuevo no responde a otro mensaje." });
  }
});

export type CommentThreadMessage = z.infer<typeof commentThreadMessageSchema>;

export function parseCommentThreadMessage(text: string): CommentThreadMessage {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("El mensaje de la conversación no es JSON válido."); }
  return commentThreadMessageSchema.parse(json);
}

export function serializeCommentThreadMessage(message: CommentThreadMessage): string {
  return JSON.stringify(commentThreadMessageSchema.parse(message));
}

export function isCommentThreadText(text: string | null | undefined): boolean {
  if (!text) return false;
  try { return (JSON.parse(text) as { kind?: unknown })?.kind === "comment_thread"; } catch { return false; }
}

/** Todo salvo el texto (en revisión) y el resultado (en ejecución) es inmutable. */
export function sameThreadSlot(a: CommentThreadMessage, b: CommentThreadMessage): boolean {
  const slot = ({ text: _t, outcome: _o, detail: _d, replyToText: _r, ...rest }: CommentThreadMessage) => rest;
  return JSON.stringify(slot(a)) === JSON.stringify(slot(b));
}

// ---------- Simulación (IA) ----------

export const threadParticipantSchema = z.object({
  deviceSerial: z.string().trim().min(1).max(160),
  phoneKey: z.string().trim().min(1).max(160),
  label: z.string().trim().min(1).max(120),
  facts: z.string().trim().max(1500).default("")
}).strict();

export type ThreadParticipant = z.infer<typeof threadParticipantSchema>;

export const simulatedMessageSchema = z.object({
  order: z.number().int().min(1).max(MAX_THREAD_MESSAGES),
  participant: z.number().int().min(0).max(MAX_THREAD_PARTICIPANTS - 1),
  mode: z.enum(["comment", "reply"]),
  replyToOrder: z.number().int().min(1).max(MAX_THREAD_MESSAGES).nullable(),
  text: z.string().trim().min(2).max(MAX_THREAD_TEXT)
}).strict();

export type SimulatedMessage = z.infer<typeof simulatedMessageSchema>;

/** Normaliza y valida la simulación devuelta por la IA contra los participantes disponibles. */
export function normalizeSimulation(raw: unknown, participantCount: number): SimulatedMessage[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { messages?: unknown })?.messages) ? (raw as { messages: unknown[] }).messages : [];
  const messages: SimulatedMessage[] = [];
  for (const item of list.slice(0, MAX_THREAD_MESSAGES)) {
    const candidate = item as Record<string, unknown>;
    const order = messages.length + 1;
    const participant = Number(candidate.participant);
    if (!Number.isInteger(participant) || participant < 0 || participant >= participantCount) continue;
    const text = String(candidate.text ?? "").trim().slice(0, MAX_THREAD_TEXT);
    if (text.length < 2) continue;
    let replyToOrder = candidate.replyToOrder == null ? null : Number(candidate.replyToOrder);
    if (replyToOrder !== null && !(Number.isInteger(replyToOrder) && replyToOrder >= 1 && replyToOrder < order)) replyToOrder = null;
    // Nadie se responde a sí mismo.
    if (replyToOrder !== null && messages[replyToOrder - 1]?.participant === participant) replyToOrder = null;
    messages.push({ order, participant, mode: replyToOrder ? "reply" : "comment", replyToOrder, text });
  }
  return messages;
}

/** Comprueba que el guion aprobado en pantalla es coherente antes de crear los trabajos. */
export function validateThreadScript(messages: readonly SimulatedMessage[], participantCount: number): void {
  if (messages.length < 2) throw new Error("La conversación necesita al menos dos mensajes.");
  if (messages.length > MAX_THREAD_MESSAGES) throw new Error(`Máximo ${MAX_THREAD_MESSAGES} mensajes por conversación.`);
  messages.forEach((message, index) => {
    if (message.order !== index + 1) throw new Error("El orden de los mensajes no es válido.");
    if (message.participant >= participantCount) throw new Error("Hay un mensaje asignado a un móvil que no participa.");
    if (message.mode === "reply") {
      if (!message.replyToOrder || message.replyToOrder >= message.order) throw new Error(`El mensaje ${message.order} responde a un mensaje posterior.`);
      if (messages[message.replyToOrder - 1]!.participant === message.participant) throw new Error(`El mensaje ${message.order} responde a su propia cuenta.`);
    } else if (message.replyToOrder !== null) {
      throw new Error(`El mensaje ${message.order} es un comentario nuevo y no puede responder a otro.`);
    }
  });
}

/** Si se eliminan mensajes en la revisión, renumera y corta las respuestas huérfanas. */
export function renumberThreadScript(messages: readonly SimulatedMessage[]): SimulatedMessage[] {
  const map = new Map<number, number>();
  messages.forEach((message, index) => map.set(message.order, index + 1));
  return messages.map((message, index) => {
    const replyToOrder = message.replyToOrder ? map.get(message.replyToOrder) ?? null : null;
    return { ...message, order: index + 1, replyToOrder, mode: replyToOrder ? "reply" : "comment" };
  });
}

export function threadSimulationSystemPrompt(): string {
  return [
    "Preparas un borrador de conversación en los comentarios de una publicación de Facebook entre varias personas reales.",
    "Cada participante es una persona real con su propia cuenta; cada una revisará y aprobará su mensaje antes de publicarlo.",
    "Reglas obligatorias:",
    "- Usa EXCLUSIVAMENTE los datos reales aportados para cada participante. No inventes familiares, negocios, cifras, compras, resultados ni experiencias.",
    "- Si un participante no tiene datos reales, que pregunte, opine con prudencia o se muestre de acuerdo, sin afirmar vivencias propias.",
    "- Tono natural de comentario de Facebook, en español de España, frases cortas y variadas; nada de spam, enlaces, hashtags ni tono publicitario.",
    "- Mezcla comentarios nuevos y respuestas. Una persona nunca se responde a sí misma.",
    "Devuelve SOLO JSON con esta forma: {\"messages\":[{\"participant\":0,\"replyToOrder\":null,\"text\":\"...\"}]}",
    "participant es el índice del participante; replyToOrder es el número (1-based) del mensaje anterior al que responde, o null si es un comentario nuevo."
  ].join("\n");
}

export function threadSimulationUserPrompt(input: { postUrl: string; postContext: string; guide: string; turns: number; participants: readonly ThreadParticipant[] }): string {
  return [
    `Publicación: ${input.postUrl}`,
    input.postContext ? `De qué trata la publicación: ${input.postContext}` : null,
    `Sobre qué deben tratar los comentarios y respuestas:\n${input.guide}`,
    `Número de mensajes: ${input.turns}`,
    "Participantes:",
    ...input.participants.map((participant, index) => `${index}. ${participant.label} — datos reales: ${participant.facts || "(sin datos: no puede afirmar experiencias propias)"}`)
  ].filter(Boolean).join("\n");
}
