/**
 * POST /api/v1/leads/inbox/suggest-reply   { phone }
 *
 * La IA propone una respuesta para la conversación abierta, leyendo el hilo
 * (entrantes + tus respuestas) y los datos del lead. Devuelve { suggestion }
 * para que el usuario la edite y envíe — no manda nada.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";

export const dynamic = "force-dynamic";

const schema = z.object({ phone: z.string().min(5).max(40) });

const SYSTEM = `Eres el comercial que atiende por WhatsApp los leads de una agencia de marketing
local (Negocio Vivo). Te paso una conversación de WhatsApp con un negocio y debes redactar
LA SIGUIENTE respuesta del comercial (no del lead).

Reglas:
- Español de España, cercano y profesional. Tuteo. Nada de "Estimado".
- Responde a lo último que dijo el lead; resuelve dudas, rebate objeciones con tacto y
  EMPUJA suavemente al siguiente paso (una llamada rápida, enviar info, agendar).
- Breve: 2-4 líneas, formato WhatsApp. Máximo 1 emoji, opcional.
- Usa el nombre/datos si los tienes. No inventes precios ni datos que no aparezcan.
- Devuelve SOLO el texto del mensaje, sin comillas ni notas.`;

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { phone } = parsed.data;

  const [inboxMsgs, campaignMsgs, meta] = await Promise.all([
    prisma.leadInboxMessage.findMany({
      where: { workspaceId: api.workspaceId, OR: [{ phoneNormalized: phone }, { fromPhone: phone }] },
      orderBy: { receivedAt: "asc" },
      take: 60,
      include: { lead: { select: { name: true, category: true, province: true, rating: true, reviewsCount: true } } }
    }),
    prisma.leadMessage.findMany({
      where: { workspaceId: api.workspaceId, phoneNormalized: phone, status: { in: ["sent", "delivered", "read"] } },
      orderBy: { sentAt: "asc" },
      take: 30,
      select: { renderedMessage: true, sentAt: true }
    }),
    prisma.leadConversationMeta.findUnique({ where: { workspaceId_phone: { workspaceId: api.workspaceId, phone } } })
  ]);

  if (inboxMsgs.length === 0 && campaignMsgs.length === 0) {
    throw new ApiError(404, "no_conversation", "No hay conversación con ese teléfono.");
  }

  // Hilo fusionado y cronológico, etiquetando quién habla.
  const thread = [
    ...campaignMsgs.map((m) => ({ at: (m.sentAt ?? new Date(0)).getTime(), who: "COMERCIAL", text: m.renderedMessage })),
    ...inboxMsgs.map((m) => ({ at: m.receivedAt.getTime(), who: m.direction === "out" ? "COMERCIAL" : "LEAD", text: m.body }))
  ]
    .sort((a, b) => a.at - b.at)
    .map((m) => `${m.who}: ${m.text}`)
    .join("\n")
    .slice(-4000);

  const lead = inboxMsgs.find((m) => m.lead)?.lead ?? null;
  const name = meta?.displayName || lead?.name || "";
  const ctx = [
    name ? `Negocio/contacto: ${name}` : null,
    lead?.category ? `Sector: ${lead.category}` : null,
    lead?.province ? `Zona: ${lead.province}` : null,
    lead?.rating != null ? `Google: ${lead.rating}★ (${lead.reviewsCount} reseñas)` : null,
    meta?.note ? `Nota interna: ${meta.note}` : null
  ]
    .filter(Boolean)
    .join("\n");

  let suggestion: string;
  try {
    suggestion = await complete({
      workspaceId: api.workspaceId,
      model: "claude-haiku-4-5-20251001",
      system: SYSTEM,
      user: `${ctx ? ctx + "\n\n" : ""}Conversación:\n${thread}\n\nRedacta la siguiente respuesta del COMERCIAL:`,
      maxTokens: 400,
      feature: "leads.inbox_suggest"
    });
    suggestion = suggestion.trim().replace(/^["']|["']$/g, "");
  } catch (e) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", "La IA no está configurada en este workspace.");
    throw e;
  }

  return NextResponse.json({ suggestion });
});
