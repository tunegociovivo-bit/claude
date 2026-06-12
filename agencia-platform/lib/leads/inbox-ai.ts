/**
 * Co-piloto IA del inbox: en una sola pasada puntúa la conversación
 * (probabilidad de cierre 0-100) y redacta un borrador de respuesta listo.
 * Se guarda en LeadConversationMeta para mostrarlo sin coste al abrir el chat.
 */
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";

const SYSTEM = `Eres el comercial que atiende leads por WhatsApp de una agencia de marketing local
(Negocio Vivo). Te paso una conversación con un negocio. Debes:
1) PUNTUAR de 0 a 100 la probabilidad de que acabe contratando (señales a favor: pregunta
   precio, urgencia, da datos, acepta llamada; en contra: "no me interesa", silencio, evasivas).
2) Dar un MOTIVO muy breve del score (máx 10 palabras).
3) Redactar la SIGUIENTE respuesta del comercial: español de España, cercana, 2-4 líneas,
   resuelve la última duda y empuja al siguiente paso (llamada/info/cita). Máx 1 emoji.
   No inventes precios ni datos que no aparezcan.

Responde SOLO el JSON pedido.`;

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string" },
    reply: { type: "string" }
  },
  required: ["score", "reason", "reply"]
};

export async function analyzeConversation(workspaceId: string, phone: string): Promise<void> {
  const [inboxMsgs, campaignMsgs, lead] = await Promise.all([
    prisma.leadInboxMessage.findMany({
      where: { workspaceId, OR: [{ phoneNormalized: phone }, { fromPhone: phone }] },
      orderBy: { receivedAt: "asc" },
      take: 40,
      include: { lead: { select: { name: true, category: true, province: true } } }
    }),
    prisma.leadMessage.findMany({
      where: { workspaceId, phoneNormalized: phone, status: { in: ["sent", "delivered", "read"] } },
      orderBy: { sentAt: "asc" },
      take: 20,
      select: { renderedMessage: true, sentAt: true }
    }),
    prisma.leadConversationMeta.findUnique({ where: { workspaceId_phone: { workspaceId, phone } } })
  ]);
  if (inboxMsgs.length === 0) return;

  const thread = [
    ...campaignMsgs.map((m) => ({ at: (m.sentAt ?? new Date(0)).getTime(), who: "COMERCIAL", text: m.renderedMessage })),
    ...inboxMsgs.map((m) => ({ at: m.receivedAt.getTime(), who: m.direction === "out" ? "COMERCIAL" : "LEAD", text: m.body }))
  ]
    .sort((a, b) => a.at - b.at)
    .map((m) => `${m.who}: ${m.text}`)
    .join("\n")
    .slice(-4000);

  const leadInfo = inboxMsgs.find((m) => m.lead)?.lead;
  const name = lead?.displayName || leadInfo?.name || "";
  const ctx = [name ? `Contacto: ${name}` : null, leadInfo?.category ? `Sector: ${leadInfo.category}` : null, lead?.note ? `Nota: ${lead.note}` : null]
    .filter(Boolean)
    .join("\n");

  const out = await completeJson<{ score: number; reason: string; reply: string }>({
    workspaceId,
    model: "claude-haiku-4-5-20251001",
    system: SYSTEM,
    user: `${ctx ? ctx + "\n\n" : ""}Conversación:\n${thread}`,
    schema: SCHEMA,
    maxTokens: 500
  });

  const score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)));
  await prisma.leadConversationMeta.upsert({
    where: { workspaceId_phone: { workspaceId, phone } },
    create: {
      workspaceId,
      phone,
      aiScore: score,
      aiScoreReason: String(out.reason ?? "").slice(0, 200),
      aiDraft: String(out.reply ?? "").slice(0, 2000),
      aiAt: new Date()
    },
    update: {
      aiScore: score,
      aiScoreReason: String(out.reason ?? "").slice(0, 200),
      aiDraft: String(out.reply ?? "").slice(0, 2000),
      aiAt: new Date()
    }
  });
}
