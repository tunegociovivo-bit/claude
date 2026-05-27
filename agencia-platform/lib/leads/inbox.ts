/**
 * Inbox: procesa mensajes WhatsApp entrantes y los clasifica con IA.
 *
 * Migra NVL_Inbox + NVL_AI_Client.classify_reply.
 */

import { prisma } from "@/lib/db/prisma";
import { completeJson, AIDisabledError } from "@/lib/ai/anthropic";
import { normalizePhone } from "./waha";

export type InboxClass =
  | "interested"
  | "objection"
  | "info_request"
  | "opt_out"
  | "off_topic"
  | "positive_no"
  | "auto_reply";

/**
 * Heurística básica (rápida y gratuita). Si la IA está deshabilitada o
 * falla, se usa esta.
 */
export function classifyHeuristic(text: string): { classification: InboxClass; confidence: number; reason: string } {
  const t = text.toLowerCase().trim();
  // Opt-out
  if (/(^|\b)(stop|baja|no.?escribir|no.?escrib[áa]is|no.?me.?escrib|d[ée]jenme|deja.?de|no.?quiero.?mensajes|no.?contact|no me llam)/.test(t)) {
    return { classification: "opt_out", confidence: 0.9, reason: "Palabra clave de baja detectada" };
  }
  // Auto-reply típico
  if (/(estamos.?ausentes|fuera.?de.?oficina|out of office|no se encuentra disponible|respuesta autom)/.test(t)) {
    return { classification: "auto_reply", confidence: 0.85, reason: "Patrón de respuesta automática" };
  }
  // Opt-out educado / positive_no
  if (/^(no\s+gracias|no\s+interesa|gracias\s+pero\s+no|de\s+momento\s+no)/.test(t)) {
    return { classification: "positive_no", confidence: 0.75, reason: "Rechazo educado" };
  }
  // Pregunta / info_request
  if (/(qu[eé]\s|c[oó]mo\s|cu[áa]ndo|cu[áa]nto|d[oó]nde|por qu[eé])/.test(t) || t.includes("?")) {
    return { classification: "info_request", confidence: 0.6, reason: "Pregunta detectada" };
  }
  // Objeción
  if (/(caro|no.?tengo.?tiempo|ahora.?no|m[áa]s.?adelante|no.?necesit|ya.?tenemos|ya.?tengo)/.test(t)) {
    return { classification: "objection", confidence: 0.7, reason: "Objeción detectada" };
  }
  // Interesado
  if (/(me interesa|cu[éeé]ntame|quiero|s[ií]\b|claro|por supuesto|pas[áa]me|envi[áa]me|env[íi]ame)/.test(t)) {
    return { classification: "interested", confidence: 0.7, reason: "Señal de interés" };
  }
  return { classification: "off_topic", confidence: 0.4, reason: "Sin palabras clave claras" };
}

const SCHEMA = {
  type: "object",
  properties: {
    classification: {
      type: "string",
      enum: ["interested", "objection", "info_request", "opt_out", "off_topic", "positive_no", "auto_reply"]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" }
  },
  required: ["classification", "confidence", "reason"]
} as const;

export async function classifyWithIA(opts: {
  workspaceId: string;
  text: string;
  leadName?: string;
}): Promise<{ classification: InboxClass; confidence: number; reason: string }> {
  const system = `Eres un asistente que clasifica respuestas WhatsApp de prospección B2B en español.
Categorías:
- interested: muestra interés ("me interesa", "cuéntame", "envíame")
- objection: pone una pega ("caro", "ahora no", "ya tengo")
- info_request: pide información concreta
- opt_out: pide ser eliminado / no más mensajes ("STOP", "BAJA")
- positive_no: rechaza educadamente sin enfadarse ("no gracias")
- off_topic: nada que ver, error, ruido
- auto_reply: respuesta automática del WhatsApp ("estoy fuera...")
Devuelve JSON con la categoría, confidence 0-1 y una razón breve.`;
  const user = `Lead: ${opts.leadName ?? "(desconocido)"}\nMensaje:\n${opts.text}`;
  try {
    const out = await completeJson<{ classification: InboxClass; confidence: number; reason: string }>({
      workspaceId: opts.workspaceId,
      system,
      user,
      schema: SCHEMA as any,
      maxTokens: 256
    });
    return out;
  } catch (e) {
    if (e instanceof AIDisabledError) {
      return classifyHeuristic(opts.text);
    }
    throw e;
  }
}

/**
 * Ingiere un mensaje WAHA entrante. Crea LeadInboxMessage, clasifica,
 * dispara acciones (opt-out, parar secuencia).
 */
export async function ingestInbox(opts: {
  workspaceId: string;
  fromPhone: string; // como llegue del webhook (puede traer @c.us)
  text: string;
  externalMessageId?: string | null;
  instanceName?: string | null;
  meta?: any;
  useIA?: boolean; // default true si hay API key
}): Promise<{ messageId: string; classification: InboxClass; leadId: string | null }> {
  const ws = await prisma.workspace.findUnique({ where: { id: opts.workspaceId } });
  const countryCode: string = (ws?.settings as any)?.leads?.whatsappCountryCode ?? "34";
  const rawPhone = String(opts.fromPhone).replace(/@.*$/, "");
  const phoneNormalized = normalizePhone(rawPhone, countryCode) ?? rawPhone;

  // Buscar lead por mensaje saliente previo, luego por phone
  let lead = await prisma.leadMessage.findFirst({
    where: { workspaceId: opts.workspaceId, phoneNormalized },
    orderBy: { createdAt: "desc" },
    select: { lead: { select: { id: true, name: true, contactStatus: true } } }
  });
  let leadId = lead?.lead?.id ?? null;
  let leadName = lead?.lead?.name;
  if (!leadId) {
    const l = await prisma.lead.findFirst({
      where: {
        workspaceId: opts.workspaceId,
        OR: [
          { phone: { contains: rawPhone } },
          { internationalPhone: { contains: rawPhone } }
        ]
      },
      select: { id: true, name: true, contactStatus: true }
    });
    if (l) {
      leadId = l.id;
      leadName = l.name;
    }
  }

  // Clasificar
  const useIA = opts.useIA ?? true;
  const classified = useIA
    ? await classifyWithIA({ workspaceId: opts.workspaceId, text: opts.text, leadName }).catch(() =>
        classifyHeuristic(opts.text)
      )
    : classifyHeuristic(opts.text);

  // Insertar mensaje
  const msg = await prisma.leadInboxMessage.create({
    data: {
      workspaceId: opts.workspaceId,
      leadId,
      fromPhone: rawPhone,
      phoneNormalized,
      channel: "whatsapp",
      direction: "in",
      body: opts.text,
      meta: opts.meta ?? undefined,
      externalMessageId: opts.externalMessageId ?? null,
      instanceName: opts.instanceName ?? null,
      classification: classified.classification,
      classificationConfidence: classified.confidence,
      classificationReason: classified.reason
    }
  });

  // Acciones según clasificación
  if (classified.classification === "opt_out") {
    await prisma.leadOptout.upsert({
      where: { workspaceId_phone: { workspaceId: opts.workspaceId, phone: phoneNormalized } },
      create: {
        workspaceId: opts.workspaceId,
        phone: phoneNormalized,
        leadId,
        reason: classified.reason,
        source: useIA ? "ai_classification" : "manual"
      },
      update: { reason: classified.reason }
    });
    // Detener secuencias activas
    if (leadId) {
      await prisma.leadSequenceAssignment.updateMany({
        where: { leadId, status: "active" },
        data: { status: "stopped", stoppedReason: "opt_out", completedAt: new Date() }
      });
    }
  } else if (["interested", "objection", "info_request"].includes(classified.classification)) {
    // Lead respondió → marcar y parar secuencias
    if (leadId) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { contactStatus: "responded" }
      });
      await prisma.leadSequenceAssignment.updateMany({
        where: { leadId, status: "active" },
        data: { status: "stopped", stoppedReason: "respuesta_recibida", completedAt: new Date() }
      });
    }

    // Fase 10 Sonia: si está activada la entrada por WhatsApp, le
    // pasamos la conversación para que clasifique más fino y
    // redacte un draft de respuesta o deje un comentario con plan.
    // Fire-and-forget: no bloqueamos al webhook si Sonia falla.
    try {
      const { triggerNvIaFromInbound } = await import("@/lib/ai/nv-ia/inbound-trigger");
      void triggerNvIaFromInbound({
        workspaceId: opts.workspaceId,
        externalId: opts.externalMessageId ?? `whatsapp-${msg.id}`,
        trigger: "WHATSAPP_INBOUND",
        taskTitle: `💬 WhatsApp de ${phoneNormalized}: ${opts.text.slice(0, 100)}`,
        body: opts.text,
        metadata: {
          from: phoneNormalized,
          classification: classified.classification,
          confidence: String(classified.confidence)
        },
        clientId: null
      }).catch((e) => console.warn("[nv-ia inbound-whatsapp]:", e?.message ?? e));
    } catch {}

    // Notificación directa a David por WhatsApp cuando un lead muestra
    // INTERÉS: número configurado en settings.leads.notifyInterestedPhone.
    // Fire-and-forget: el webhook no se bloquea si la notificación falla.
    if (classified.classification === "interested") {
      const notifyTo: string | undefined =
        (ws?.settings as any)?.leads?.notifyInterestedPhone;
      if (notifyTo) {
        const notifyNormalized = normalizePhone(notifyTo, countryCode);
        if (notifyNormalized) {
          const summary = [
            `🔥 Lead interesado`,
            leadName ? `• Negocio: ${leadName}` : null,
            `• Teléfono: ${phoneNormalized}`,
            `• Mensaje: "${opts.text.slice(0, 220)}${opts.text.length > 220 ? "…" : ""}"`,
            classified.confidence
              ? `• Confianza IA: ${Math.round(classified.confidence * 100)}%`
              : null,
            ``,
            `Abre la conversación en el Hub para responder.`
          ]
            .filter(Boolean)
            .join("\n");
          void (async () => {
            try {
              const { sendText } = await import("./waha");
              await sendText({
                workspaceId: opts.workspaceId,
                phoneNormalized: notifyNormalized,
                text: summary
              });
            } catch (e: any) {
              console.warn("[inbox notify-interested]:", e?.message ?? e);
            }
          })();
        }
      }
    }
  }

  return { messageId: msg.id, classification: classified.classification, leadId };
}
