import { prisma } from "@/lib/db/prisma";

type LearningMessage = {
  direction: string; body: string; phoneNormalized: string | null; fromPhone: string;
  leadId: string | null; classification: string | null; meta: unknown; receivedAt: Date;
  lead?: { category: string | null } | null;
};

export type ReplyExample = { customer: string; reply: string; category: string | null; score: number };

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{4,}/g) ?? []);
}

function sourceOf(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const source = (meta as Record<string, unknown>).source;
  return typeof source === "string" ? source : null;
}

export function selectReplyExamples(messages: LearningMessage[], current: { phone: string; text: string; category?: string | null; classification?: string | null }, limit = 6): ReplyExample[] {
  const grouped = new Map<string, LearningMessage[]>();
  for (const message of messages) {
    const key = message.leadId || message.phoneNormalized || message.fromPhone;
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), message]);
  }
  const currentWords = words(current.text);
  const examples: ReplyExample[] = [];
  for (const list of grouped.values()) {
    list.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    for (let index = 1; index < list.length; index++) {
      const reply = list[index];
      const customer = list[index - 1];
      if (reply.direction !== "out" || customer.direction !== "in") continue;
      const source = sourceOf(reply.meta);
      if (source && !["human_reply", "phone_outbound"].includes(source)) continue;
      if (reply.body.trim().length < 3 || customer.body.trim().length < 3) continue;
      const key = reply.leadId || reply.phoneNormalized || reply.fromPhone;
      if (key === current.phone) continue;
      const overlap = [...words(customer.body)].filter((word) => currentWords.has(word)).length;
      const category = reply.lead?.category ?? customer.lead?.category ?? null;
      const score = overlap * 3 + (category && category === current.category ? 8 : 0)
        + (customer.classification && customer.classification === current.classification ? 5 : 0)
        + Math.max(0, 3 - Math.floor((Date.now() - reply.receivedAt.getTime()) / 30 / 86400000));
      examples.push({ customer: customer.body.trim().slice(0, 800), reply: reply.body.trim().slice(0, 1200), category, score });
    }
  }
  return examples.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function buildReplyLearningContext(opts: { workspaceId: string; phone: string; currentText: string; category?: string | null; classification?: string | null }): Promise<string> {
  const messages = await prisma.leadInboxMessage.findMany({
    where: { workspaceId: opts.workspaceId, direction: { in: ["in", "out"] } },
    orderBy: { receivedAt: "desc" }, take: 900,
    include: { lead: { select: { category: true } } }
  });
  const examples = selectReplyExamples(messages, { phone: opts.phone, text: opts.currentText, category: opts.category, classification: opts.classification });
  if (!examples.length) return "";
  return `\n\nEJEMPLOS REALES DEL ESTILO DEL USUARIO (imita tono y estrategia; nunca copies nombres, precios ni datos entre clientes):\n${examples.map((example, index) => `${index + 1}. Lead: ${example.customer}\n   Respuesta del usuario: ${example.reply}`).join("\n")}`;
}
