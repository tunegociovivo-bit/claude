import { z } from "zod";

/** Comprobación posterior: ¿siguen visibles los comentarios? ¿cuántas reacciones y respuestas tienen? */
export const threadCheckItemSchema = z.object({
  jobId: z.string().max(100),
  order: z.number().int().min(1).max(50),
  text: z.string().min(1).max(1200),
  visible: z.boolean().nullable().default(null),
  reactions: z.number().int().min(0).nullable().default(null),
  replies: z.number().int().min(0).nullable().default(null)
}).strict();

export const threadCheckSchema = z.object({
  kind: z.literal("thread_check"),
  version: z.literal(1),
  threadId: z.string().uuid(),
  postUrl: z.string().url().max(2048),
  checkedAt: z.string().max(40).nullable().default(null),
  items: z.array(threadCheckItemSchema).min(1).max(50)
}).strict();

export type ThreadCheck = z.infer<typeof threadCheckSchema>;

export function parseThreadCheck(text: string): ThreadCheck {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("La comprobación no es JSON válido."); }
  return threadCheckSchema.parse(json);
}
export function serializeThreadCheck(check: ThreadCheck): string { return JSON.stringify(threadCheckSchema.parse(check)); }
export function isThreadCheckText(text: string | null | undefined) {
  if (!text) return false;
  try { return (JSON.parse(text) as { kind?: unknown })?.kind === "thread_check"; } catch { return false; }
}
export function sameThreadCheckTargets(a: ThreadCheck, b: ThreadCheck) {
  const ids = (check: ThreadCheck) => check.items.map((item) => `${item.jobId}:${item.text}`).join("|");
  return a.threadId === b.threadId && a.postUrl === b.postUrl && ids(a) === ids(b);
}

