/**
 * Auto-piloto de seguimiento.
 *
 * Si un lead CALIENTE se queda en silencio después de NUESTRA última respuesta,
 * la IA redacta y envía sola un follow-up suave, con cadencia decreciente
 * (24h → 72h → 7d, máx 3 toques). Se detiene en cuanto el lead vuelve a
 * escribir (ingestInbox reinicia el contador) o si pide la baja. Respeta el
 * anti-baneo del número (ventana horaria + cadencia mínima compartida) y solo
 * actúa si el workspace lo activa en Ajustes (settings.leads.autoFollowupEnabled).
 *
 * Se engancha al cron de leads (tick de 1 min), igual que la difusión.
 */
import { prisma } from "@/lib/db/prisma";
import { getSendSettings, isInsideWindow, SENT_STATUSES } from "./send-queue";
import { sendText } from "./waha";
import { complete } from "@/lib/ai/anthropic";

/** Horas de silencio necesarias antes de cada toque (por step). */
const CADENCE_HOURS = [24, 72, 168];
const MAX_STEPS = 3;
/** Score mínimo (o clasificación de interés) para que merezca la pena insistir. */
const SCORE_THRESHOLD = 55;
/** No revivir conversaciones muertas: si el último mensaje es de hace más de
 *  esto, no insistimos (mejor dejarlo morir que parecer spam). */
const STALE_DAYS = 30;

const WORTHY_CLASS = new Set(["interested", "objection", "info_request"]);

const DRAFT_SYSTEM = `Eres el comercial que atiende leads por WhatsApp de una agencia de marketing local
(Negocio Vivo). El lead mostró interés pero lleva un tiempo sin contestar. Escribe UN follow-up
breve para reactivar la conversación SIN agobiar:
- Español de España, cercano, 1-2 líneas. Tuteo. Máximo 1 emoji.
- Retoma el hilo (lo último que se habló) y termina con UNA pregunta fácil de responder.
- Nada de "¿sigues ahí?" ni presión. No inventes precios ni datos.
- Si es el 2º o 3er toque, cambia el enfoque (aporta un beneficio o una idea nueva).
Devuelve SOLO el texto del mensaje, sin comillas.`;

export async function processAutoFollowupTick(workspaceId: string): Promise<{
  processed: boolean;
  phone?: string;
  step?: number;
  error?: string;
}> {
  const settings = await getSendSettings(workspaceId);
  if (!settings.sendEnabled || settings.sendPaused) return { processed: false, error: "paused" };

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  if (!((ws?.settings as any)?.leads?.autoFollowupEnabled)) return { processed: false, error: "disabled" };

  const now = new Date();
  if (!isInsideWindow(settings, now)) return { processed: false, error: "outside_window" };

  // Pacing compartido: no enviar si algo (campaña, difusión o cualquier salida
  // del inbox) salió dentro de la cadencia mínima — evita ráfagas del número.
  const since = new Date(now.getTime() - settings.sendDelayMinSec * 1000);
  const [recentCampaign, recentBroadcast, recentOut] = await Promise.all([
    prisma.leadMessage.findFirst({ where: { workspaceId, status: { in: SENT_STATUSES }, sentAt: { gte: since } }, select: { id: true } }),
    prisma.leadBroadcastRecipient.findFirst({ where: { workspaceId, status: "sent", sentAt: { gte: since } }, select: { id: true } }),
    prisma.leadInboxMessage.findFirst({ where: { workspaceId, direction: "out", receivedAt: { gte: since } }, select: { id: true } })
  ]);
  if (recentCampaign || recentBroadcast || recentOut) return { processed: false, error: "pacing_wait" };

  // Estado por conversación: últimos mensajes agrupados por teléfono.
  const [msgs, metas, optouts] = await Promise.all([
    prisma.leadInboxMessage.findMany({
      where: { workspaceId },
      orderBy: { receivedAt: "desc" },
      take: 600,
      include: { lead: { select: { id: true, name: true } } }
    }),
    prisma.leadConversationMeta.findMany({ where: { workspaceId } }),
    prisma.leadOptout.findMany({ where: { workspaceId }, select: { phone: true } })
  ]);
  const metaByPhone = new Map(metas.map((m) => [m.phone, m]));
  const optoutSet = new Set(optouts.map((o) => o.phone));

  type Conv = {
    phone: string;
    lastDir: string;
    lastAt: Date;
    chatId: string | null;
    instanceName: string | null;
    leadId: string | null;
    leadName: string | null;
    hasInbound: boolean;
    lastInboundClass: string | null;
  };
  const byPhone = new Map<string, Conv>();
  for (const m of msgs) {
    const phone = m.phoneNormalized ?? m.fromPhone;
    let c = byPhone.get(phone);
    if (!c) {
      c = {
        phone,
        lastDir: m.direction,
        lastAt: m.receivedAt,
        chatId: null,
        instanceName: null,
        leadId: m.lead?.id ?? null,
        leadName: m.lead?.name ?? null,
        hasInbound: false,
        lastInboundClass: null
      };
      byPhone.set(phone, c);
    }
    if (!c.leadId && m.lead) { c.leadId = m.lead.id; c.leadName = m.lead.name; }
    if (m.direction === "in") {
      c.hasInbound = true;
      if (c.lastInboundClass === null && m.classification) c.lastInboundClass = m.classification;
      if (c.chatId === null) {
        const meta: any = m.meta ?? {};
        c.chatId = (typeof meta?.payload?.from === "string" && meta.payload.from) || (String(m.fromPhone).includes("@") ? String(m.fromPhone) : null);
        c.instanceName = c.instanceName ?? m.instanceName;
      }
    }
  }

  // Elegir el mejor candidato: caliente, en silencio tras nuestra respuesta y
  // con la cadencia del step cumplida. Priorizamos el de mayor score.
  let best: { conv: Conv; step: number; score: number } | null = null;
  for (const c of byPhone.values()) {
    if (!c.hasInbound || c.lastDir !== "out") continue; // solo si escribimos último
    if (optoutSet.has(c.phone) || c.lastInboundClass === "opt_out") continue;
    const meta = metaByPhone.get(c.phone);
    if (meta?.autoFollowupOff || meta?.archived || meta?.status === "resolved") continue;
    const step = meta?.autoFollowupStep ?? 0;
    if (step >= MAX_STEPS) continue;
    const score = meta?.aiScore ?? 0;
    const worthy = score >= SCORE_THRESHOLD || (c.lastInboundClass != null && WORTHY_CLASS.has(c.lastInboundClass));
    if (!worthy) continue;
    const elapsedH = (now.getTime() - c.lastAt.getTime()) / 3_600_000;
    if (elapsedH < CADENCE_HOURS[step]) continue;
    if (elapsedH > STALE_DAYS * 24) continue;
    if (!best || score > best.score) best = { conv: c, step, score };
  }
  if (!best) return { processed: false };

  const { conv, step } = best;

  // Hilo reciente para que el nudge tenga contexto.
  const recent = await prisma.leadInboxMessage.findMany({
    where: { workspaceId, OR: [{ phoneNormalized: conv.phone }, { fromPhone: conv.phone }] },
    orderBy: { receivedAt: "asc" },
    take: 16,
    select: { direction: true, body: true }
  });
  const thread = recent.map((m) => `${m.direction === "out" ? "COMERCIAL" : "LEAD"}: ${m.body}`).join("\n").slice(-3000);

  let text: string;
  try {
    text = (
      await complete({
        workspaceId,
        model: "claude-haiku-4-5-20251001",
        system: DRAFT_SYSTEM,
        user: `Toque nº ${step + 1} de 3.${conv.leadName ? ` Contacto: ${conv.leadName}.` : ""}\n\nConversación:\n${thread}\n\nEscribe el follow-up:`,
        maxTokens: 300,
        feature: "leads.auto_followup"
      })
    ).trim().replace(/^["']|["']$/g, "");
  } catch (e: any) {
    return { processed: false, error: `draft_failed: ${e?.message ?? e}` };
  }
  if (!text) return { processed: false, error: "empty_draft" };

  const chatId = conv.chatId || conv.phone;
  try {
    const out = await sendText({ workspaceId, phoneNormalized: chatId, text, session: conv.instanceName ?? undefined });
    await prisma.leadInboxMessage.create({
      data: {
        workspaceId,
        leadId: conv.leadId,
        fromPhone: conv.phone,
        phoneNormalized: conv.phone,
        channel: "whatsapp",
        direction: "out",
        body: text,
        read: true,
        externalMessageId: out.messageId ?? null,
        instanceName: conv.instanceName ?? null,
        meta: { autoFollowup: true, step: step + 1 }
      }
    });
    await prisma.leadConversationMeta.upsert({
      where: { workspaceId_phone: { workspaceId, phone: conv.phone } },
      create: { workspaceId, phone: conv.phone, autoFollowupStep: step + 1, autoFollowupLastAt: new Date() },
      update: { autoFollowupStep: step + 1, autoFollowupLastAt: new Date() }
    });
    return { processed: true, phone: conv.phone, step: step + 1 };
  } catch (e: any) {
    return { processed: false, error: `send_failed: ${e?.message ?? e}` };
  }
}
