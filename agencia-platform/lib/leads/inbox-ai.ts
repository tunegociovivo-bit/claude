/**
 * Co-piloto IA del inbox: en una sola pasada puntúa la conversación
 * (probabilidad de cierre 0-100), redacta un borrador de respuesta listo y
 * detecta el "momento de comprar" (alta intención) con un guion de cierre para
 * llamar. Se guarda en LeadConversationMeta para mostrarlo sin coste al abrir
 * el chat; cuando salta el momento de comprar, avisa a los admins por push.
 */
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { buildReplyLearningContext } from "./reply-learning";

const SYSTEM = `Eres el comercial que atiende leads por WhatsApp de una agencia de marketing local
(Negocio Vivo). Te paso una conversación con un negocio. Debes:
1) PUNTUAR de 0 a 100 la probabilidad de que acabe contratando (señales a favor: pregunta
   precio, urgencia, da datos, acepta llamada; en contra: "no me interesa", silencio, evasivas).
2) Dar un MOTIVO muy breve del score (máx 10 palabras).
3) Redactar la SIGUIENTE respuesta del comercial: español de España, cercana, 2-4 líneas,
   resuelve la última duda y empuja al siguiente paso (llamada/info/cita). Máx 1 emoji.
   No inventes precios ni datos que no aparezcan.
4) MOMENTO DE COMPRAR: pon callNow=true SOLO si el lead muestra intención ALTA y reciente de
   cerrar YA (pregunta precio/condiciones concretas, "¿cuándo podéis?", pide contratar, da
   urgencia). Si callNow=true, escribe callScript: un guion BREVE (3-4 frases) para que el
   comercial LLAME por teléfono y cierre — saludo, valor en una frase, propuesta de siguiente
   paso y cierre con pregunta. Si no hay intención alta, callNow=false y callScript="".

Responde SOLO el JSON pedido.`;

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string" },
    reply: { type: "string" },
    callNow: { type: "boolean" },
    callScript: { type: "string" }
  },
  required: ["score", "reason", "reply", "callNow"]
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

  const lastInbound = [...inboxMsgs].reverse().find((message) => message.direction === "in");
  const learnedStyle = await buildReplyLearningContext({
    workspaceId,
    phone,
    currentText: lastInbound?.body ?? thread,
    category: leadInfo?.category ?? null,
    classification: lastInbound?.classification ?? null
  });

  const out = await completeJson<{ score: number; reason: string; reply: string; callNow?: boolean; callScript?: string }>({
    workspaceId,
    model: "claude-haiku-4-5-20251001",
    system: SYSTEM,
    user: `${ctx ? ctx + "\n\n" : ""}Conversación:\n${thread}${learnedStyle}`,
    schema: SCHEMA,
    maxTokens: 600
  });

  const score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)));
  const callNow = !!out.callNow && score >= 60; // doble filtro: alta intención + score alto
  const callScript = callNow ? String(out.callScript ?? "").slice(0, 800) : "";
  const wasCallNow = !!lead?.aiCallNow;

  await prisma.leadConversationMeta.upsert({
    where: { workspaceId_phone: { workspaceId, phone } },
    create: {
      workspaceId,
      phone,
      aiScore: score,
      aiScoreReason: String(out.reason ?? "").slice(0, 200),
      aiDraft: String(out.reply ?? "").slice(0, 2000),
      aiCallNow: callNow,
      aiCallScript: callScript,
      aiAt: new Date()
    },
    update: {
      aiScore: score,
      aiScoreReason: String(out.reason ?? "").slice(0, 200),
      aiDraft: String(out.reply ?? "").slice(0, 2000),
      aiCallNow: callNow,
      aiCallScript: callScript,
      aiAt: new Date()
    }
  });

  // Momento de comprar: avisa SOLO en la transición a callNow (no en cada
  // mensaje) para no saturar. Push + in-app a los admins del workspace.
  if (callNow && !wasCallNow) {
    void notifyCallNow(workspaceId, phone, name, leadInfo?.name ?? null).catch((e) =>
      console.warn("[inbox-ai callNow notify]", e?.message ?? e)
    );
  }
}

async function notifyCallNow(workspaceId: string, phone: string, displayName: string, leadName: string | null): Promise<void> {
  const admins = await prisma.membership.findMany({
    where: { workspaceId, role: "ADMIN" },
    select: { userId: true }
  });
  if (admins.length === 0) return;
  const who = displayName || leadName || phone;
  const body = `📞 ${who} está en MOMENTO DE COMPRAR. Llámale ya: tienes el guion de cierre en el chat.`;
  const link = "/admin/leads";
  await prisma.notification.createMany({
    data: admins.map((a) => ({ userId: a.userId, type: "lead_call_now", body, link }))
  });
  const { sendPushToUser } = await import("@/lib/push/web-push");
  await Promise.all(
    admins.map((a) =>
      sendPushToUser(a.userId, { title: "📞 Llama ahora", body, link, tag: `lead-call-now-${phone}` }).catch(() => {})
    )
  );
}
