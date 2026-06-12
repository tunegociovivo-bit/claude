/**
 * Difusión segmentada (broadcast) del inbox multi-WhatsApp.
 *
 * Envía un mismo mensaje a un SEGMENTO de conversaciones existentes (las que
 * filtres por clasificación IA, estado o prioridad). A diferencia de una
 * campaña a leads fríos, aquí escribimos a gente que YA nos habló, así que el
 * riesgo de baneo es menor — pero seguimos respetando el anti-baneo del número:
 * cada destinatario se programa ESPACIADO (delay min–max, ventana horaria) y el
 * cron entrega de uno en uno respetando la cadencia mínima y el tope por hora.
 *
 * El procesado se engancha en runLeadsCronAllWorkspaces (tick de 1 min), igual
 * que la cola de campañas.
 */
import { prisma } from "@/lib/db/prisma";
import {
  getSendSettings,
  isInsideWindow,
  computeNextSlot,
  countSentInWindow,
  SENT_STATUSES
} from "./send-queue";
import { sendText } from "./waha";

export type BroadcastSegment = {
  classifications?: string[]; // interested|objection|info_request|positive_no|off_topic|...
  statuses?: string[]; // pending|followup|resolved
  priorities?: string[]; // alta|media|baja|none
  includeArchived?: boolean; // por defecto false
};

type Target = {
  phone: string;
  chatId: string | null;
  instanceName: string | null;
  leadId: string | null;
  name: string;
};

/** Sustituye {{nombre}} / {nombre} por el nombre del contacto (o vacío). */
function personalize(body: string, name: string): string {
  return body.replace(/\{\{?\s*nombre\s*\}?\}/gi, name || "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Resuelve el segmento a partir de las conversaciones del inbox: agrupa los
 * últimos mensajes por teléfono, toma la clasificación del último entrante y el
 * chatId original para responder, y aplica los filtros pedidos. Excluye
 * siempre opt-outs y, por defecto, conversaciones archivadas.
 */
export async function resolveSegment(
  workspaceId: string,
  segment: BroadcastSegment
): Promise<Target[]> {
  const [msgs, metas, optouts] = await Promise.all([
    prisma.leadInboxMessage.findMany({
      where: { workspaceId },
      orderBy: { receivedAt: "desc" },
      take: 2000,
      include: { lead: { select: { id: true, name: true } } }
    }),
    prisma.leadConversationMeta.findMany({ where: { workspaceId } }),
    prisma.leadOptout.findMany({ where: { workspaceId }, select: { phone: true } })
  ]);
  const metaByPhone = new Map(metas.map((m) => [m.phone, m]));
  const optoutSet = new Set(optouts.map((o) => o.phone));

  type Acc = Target & { classification: string | null; hasInbound: boolean };
  const byPhone = new Map<string, Acc>();
  for (const m of msgs) {
    const phone = m.phoneNormalized ?? m.fromPhone;
    let c = byPhone.get(phone);
    if (!c) {
      const meta = metaByPhone.get(phone);
      c = {
        phone,
        chatId: null,
        instanceName: null,
        leadId: m.lead?.id ?? null,
        name: meta?.displayName || m.lead?.name || "",
        classification: null,
        hasInbound: false
      };
      byPhone.set(phone, c);
    }
    if (!c.leadId && m.lead) c.leadId = m.lead.id;
    if (m.direction === "in") {
      c.hasInbound = true;
      // El entrante más reciente (msgs viene desc) fija el canal y chatId de
      // respuesta y la clasificación con la que filtramos.
      if (c.classification === null && m.classification) c.classification = m.classification;
      if (c.instanceName === null && m.instanceName) c.instanceName = m.instanceName;
      if (c.chatId === null) {
        const meta: any = m.meta ?? {};
        c.chatId =
          (typeof meta?.payload?.from === "string" && meta.payload.from) ||
          (String(m.fromPhone).includes("@") ? String(m.fromPhone) : null);
      }
    }
  }

  const cls = segment.classifications?.length ? new Set(segment.classifications) : null;
  const sts = segment.statuses?.length ? new Set(segment.statuses) : null;
  const pri = segment.priorities?.length ? new Set(segment.priorities) : null;

  const out: Target[] = [];
  for (const c of byPhone.values()) {
    if (!c.hasInbound) continue; // solo a quien nos ha escrito
    if (optoutSet.has(c.phone)) continue; // nunca a opt-outs
    const meta = metaByPhone.get(c.phone);
    if (!segment.includeArchived && meta?.archived) continue;
    // Nunca difundir a quien dijo "no me interesa" / pidió baja.
    if (c.classification === "opt_out") continue;
    if (cls && !cls.has(c.classification ?? "")) continue;
    if (sts && !sts.has(meta?.status ?? "pending")) continue;
    if (pri && !pri.has(meta?.priority ?? "none")) continue;
    out.push({ phone: c.phone, chatId: c.chatId, instanceName: c.instanceName, leadId: c.leadId, name: c.name });
  }
  return out;
}

/** Cuenta a cuántos contactos llegaría la difusión (para la previsualización). */
export async function previewSegment(workspaceId: string, segment: BroadcastSegment): Promise<number> {
  return (await resolveSegment(workspaceId, segment)).length;
}

/**
 * Crea una difusión: resuelve el segmento y programa cada destinatario
 * ESPACIADO (anti-baneo), encadenando los slots desde ahora respetando la
 * ventana horaria configurada.
 */
export async function createBroadcast(opts: {
  workspaceId: string;
  text: string;
  segment: BroadcastSegment;
  createdBy?: string | null;
}): Promise<{ broadcastId: string; total: number; firstAt: Date | null; lastAt: Date | null }> {
  const text = opts.text.trim();
  if (!text) throw new Error("Mensaje vacío");
  const targets = await resolveSegment(opts.workspaceId, opts.segment);
  if (targets.length === 0) throw new Error("El segmento no incluye a ningún contacto");

  const settings = await getSendSettings(opts.workspaceId);

  // Encadenamos slots desde ahora (uno cada delay min–max) respetando ventana.
  const recipients: {
    workspaceId: string;
    broadcastId: string;
    phone: string;
    chatId: string | null;
    instanceName: string | null;
    leadId: string | null;
    body: string;
    status: string;
    scheduledAt: Date;
  }[] = [];

  const broadcast = await prisma.leadBroadcast.create({
    data: {
      workspaceId: opts.workspaceId,
      body: text,
      segment: opts.segment as any,
      total: targets.length,
      status: "running",
      createdBy: opts.createdBy ?? null
    }
  });

  let prev = new Date();
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;
  let isFirst = true;
  for (const t of targets) {
    const gapSec =
      settings.sendDelayMinSec +
      Math.random() * Math.max(0, settings.sendDelayMaxSec - settings.sendDelayMinSec);
    const desired = isFirst ? new Date() : new Date(prev.getTime() + gapSec * 1000);
    const slot = await computeNextSlot({ workspaceId: opts.workspaceId, desired, settings });
    recipients.push({
      workspaceId: opts.workspaceId,
      broadcastId: broadcast.id,
      phone: t.phone,
      chatId: t.chatId,
      instanceName: t.instanceName,
      leadId: t.leadId,
      body: personalize(text, t.name),
      status: "queued",
      scheduledAt: slot
    });
    prev = slot;
    if (!firstAt) firstAt = slot;
    lastAt = slot;
    isFirst = false;
  }

  await prisma.leadBroadcastRecipient.createMany({ data: recipients });
  return { broadcastId: broadcast.id, total: targets.length, firstAt, lastAt };
}

/**
 * Procesa 1 destinatario de difusión vencido, respetando el anti-baneo del
 * número (ventana horaria, cadencia mínima y tope por hora COMPARTIDOS con la
 * cola de campañas, para no saturar el número entre ambas vías).
 */
export async function processBroadcastTick(workspaceId: string): Promise<{
  processed: boolean;
  recipientId?: string;
  status?: string;
  error?: string;
}> {
  const settings = await getSendSettings(workspaceId);
  if (!settings.sendEnabled || settings.sendPaused) return { processed: false, error: "paused" };

  const now = new Date();
  if (!isInsideWindow(settings, now)) return { processed: false, error: "outside_window" };

  // Pacing compartido: no enviar si la cola de campañas o una difusión ya
  // mandó algo dentro de la cadencia mínima (evita ráfagas del número).
  const since = new Date(now.getTime() - settings.sendDelayMinSec * 1000);
  const [recentCampaign, recentBroadcast] = await Promise.all([
    prisma.leadMessage.findFirst({
      where: { workspaceId, status: { in: SENT_STATUSES }, sentAt: { gte: since } },
      select: { id: true }
    }),
    prisma.leadBroadcastRecipient.findFirst({
      where: { workspaceId, status: "sent", sentAt: { gte: since } },
      select: { id: true }
    })
  ]);
  if (recentCampaign || recentBroadcast) return { processed: false, error: "pacing_wait" };

  // Tope por hora compartido.
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [campaignHour, broadcastHour] = await Promise.all([
    countSentInWindow(workspaceId, 60),
    prisma.leadBroadcastRecipient.count({
      where: { workspaceId, status: "sent", sentAt: { gte: hourAgo } }
    })
  ]);
  if (campaignHour + broadcastHour >= settings.maxPerHour) return { processed: false, error: "hourly_limit" };

  const rec = await prisma.leadBroadcastRecipient.findFirst({
    where: { workspaceId, status: "queued", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" }
  });
  if (!rec) return { processed: false };

  const chatId = rec.chatId || rec.phone;
  try {
    const out = await sendText({
      workspaceId,
      phoneNormalized: chatId,
      text: rec.body,
      session: rec.instanceName ?? undefined
    });
    await prisma.leadBroadcastRecipient.update({
      where: { id: rec.id },
      data: { status: "sent", sentAt: new Date(), externalMessageId: out.messageId ?? null }
    });
    // Reflejar el envío en el hilo del inbox.
    await prisma.leadInboxMessage.create({
      data: {
        workspaceId,
        leadId: rec.leadId,
        fromPhone: rec.phone,
        phoneNormalized: rec.phone,
        channel: "whatsapp",
        direction: "out",
        body: rec.body,
        read: true,
        externalMessageId: out.messageId ?? null,
        instanceName: rec.instanceName ?? null
      }
    });
    await bumpBroadcast(rec.broadcastId, workspaceId, "sent");
    return { processed: true, recipientId: rec.id, status: "sent" };
  } catch (e: any) {
    await prisma.leadBroadcastRecipient.update({
      where: { id: rec.id },
      data: { status: "failed", error: String(e?.message ?? e).slice(0, 500) }
    });
    await bumpBroadcast(rec.broadcastId, workspaceId, "failed");
    return { processed: true, recipientId: rec.id, status: "failed", error: e?.message };
  }
}

/** Actualiza contadores de la difusión y la marca "done" cuando no queda cola. */
async function bumpBroadcast(broadcastId: string, workspaceId: string, kind: "sent" | "failed"): Promise<void> {
  await prisma.leadBroadcast.update({
    where: { id: broadcastId },
    data: kind === "sent" ? { sentCount: { increment: 1 } } : { failedCount: { increment: 1 } }
  });
  const pending = await prisma.leadBroadcastRecipient.count({
    where: { workspaceId, broadcastId, status: "queued" }
  });
  if (pending === 0) {
    await prisma.leadBroadcast.update({ where: { id: broadcastId }, data: { status: "done" } });
  }
}
