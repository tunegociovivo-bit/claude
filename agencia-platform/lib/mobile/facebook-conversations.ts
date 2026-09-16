import { z } from "zod";
import { validCalendarDate } from "./conversation-search";

export const MAX_CONVERSATION_BATCH_TEXT = 500_000;
export const conversationScanConfigSchema = z.object({
  targetUrl: z.string().max(2048).default(""),
  searchMode: z.enum(["groups", "posts"]).optional(),
  searchTerm: z.string().trim().max(200).optional(),
  dateFrom: z.string().refine(validCalendarDate, "Fecha inicial no válida").optional(),
  dateTo: z.string().refine(validCalendarDate, "Fecha final no válida").optional(),
  niche: z.string().trim().max(200).default(""),
  criteria: z.string().trim().max(4000).default(""),
  replyGuidance: z.string().trim().min(3).max(4000),
  lookbackDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  referenceTime: z.string().datetime().optional(),
  postsPerGroup: z.number().int().min(1).max(20).default(5),
  commentScreensPerPost: z.number().int().min(1).max(20).default(5)
}).strict().superRefine((value, context) => {
  if (Boolean(value.dateFrom) !== Boolean(value.dateTo) || (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["dateTo"], message: "Indica un intervalo válido, con fecha inicial y final." });
});
export type ConversationScanConfig = z.infer<typeof conversationScanConfigSchema>;

export const conversationReplySchema = z.object({
  id: z.string().min(1).max(100),
  groupName: z.string().min(1).max(300),
  groupDetails: z.string().max(300).optional(),
  groupUrl: z.string().max(2048),
  postAnchor: z.string().min(1).max(3000),
  author: z.string().max(200),
  sourceText: z.string().min(1).max(3000),
  sourceLabel: z.string().min(1).max(6000),
  dateLabel: z.string().max(100).optional(),
  reply: z.string().max(2000),
  reason: z.string().max(500),
  selected: z.boolean(),
  outcome: z.enum(["pending", "sending", "sent", "review", "failed"]),
  detail: z.string().max(500).default("")
}).strict();
export type ConversationReply = z.infer<typeof conversationReplySchema>;

export const facebookConversationBatchSchema = z.object({
  kind: z.literal("facebook_conversations"),
  version: z.literal(1),
  config: conversationScanConfigSchema,
  groups: z.array(z.object({ name: z.string().max(300), details: z.string().max(300).optional(), status: z.enum(["pending", "done", "excluded", "failed"]), detail: z.string().max(500) }).strict()).max(1000),
  candidates: z.array(conversationReplySchema).max(150),
  inventoryComplete: z.boolean(),
  progress: z.string().max(1000),
  warnings: z.array(z.string().max(500)).max(100)
}).strict();
export type FacebookConversationBatch = z.infer<typeof facebookConversationBatchSchema>;

export function createConversationBatch(config: ConversationScanConfig): FacebookConversationBatch {
  return { kind: "facebook_conversations", version: 1, config: conversationScanConfigSchema.parse({ ...config, lookbackDays: config.lookbackDays ?? 30, referenceTime: config.referenceTime ?? new Date().toISOString() }), groups: [], candidates: [], inventoryComplete: false, progress: "Pendiente de búsqueda", warnings: [] };
}
export function parseConversationBatch(text: string): FacebookConversationBatch {
  if (text.length > MAX_CONVERSATION_BATCH_TEXT) throw new Error("El lote de conversaciones supera el tamaño permitido.");
  return facebookConversationBatchSchema.parse(JSON.parse(text));
}
export function serializeConversationBatch(batch: FacebookConversationBatch): string {
  const text = JSON.stringify(facebookConversationBatchSchema.parse(batch));
  if (text.length > MAX_CONVERSATION_BATCH_TEXT) throw new Error("El lote de conversaciones supera el tamaño permitido.");
  return text;
}
export function normalizeFacebookText(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("es");
}
export function conversationFingerprint(parts: string[]) {
  const input = parts.map(normalizeFacebookText).join("\u001f");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `conversation-${(hash >>> 0).toString(16)}`;
}

/** The review UI may change only selections and reply text, never recipients. */
export function validateConversationApproval(original: FacebookConversationBatch, edited: FacebookConversationBatch) {
  if (original.candidates.length !== edited.candidates.length) throw new Error("La lista de comentarios ha cambiado. Actualiza los resultados.");
  const allowed = new Map(original.candidates.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const candidates = edited.candidates.map((item) => {
    const saved = allowed.get(item.id);
    if (!saved || seen.has(item.id)) throw new Error("Comentario no válido.");
    seen.add(item.id);
    const { selected: _a, reply: _b, ...identity } = saved;
    const { selected: _c, reply: _d, ...editedIdentity } = item;
    if (Object.keys(identity).some((key) => identity[key as keyof typeof identity] !== editedIdentity[key as keyof typeof editedIdentity])) throw new Error("No se puede cambiar el destinatario de una respuesta.");
    return { ...saved, selected: item.selected, reply: item.reply };
  });
  if (candidates.some((item) => item.selected && ["pending", "failed"].includes(item.outcome) && !item.reply.trim())) throw new Error("Las respuestas seleccionadas no pueden estar vacías.");
  if (!candidates.some((item) => item.selected && ["pending", "failed"].includes(item.outcome))) throw new Error("Selecciona al menos una respuesta pendiente.");
  return { ...original, candidates };
}
