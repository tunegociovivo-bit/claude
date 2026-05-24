/**
 * Send Queue: encolar mensajes, calcular `scheduledAt` respetando ventana
 * horaria, delays y daily limit. Procesar la cola (1 mensaje por tick).
 *
 * Migra NVL_Send_Queue.
 */

import { prisma } from "@/lib/db/prisma";
import { renderTemplate, varyMessage } from "./template-engine";
import { normalizePhone, sendText, getWahaConfig } from "./waha";

export type LeadsSendSettings = {
  sendEnabled: boolean;
  sendDelayMinSec: number;
  sendDelayMaxSec: number;
  sendWindowStart: string; // "HH:MM"
  sendWindowEnd: string;
  sendOnWeekends: boolean;
  dailyLimit: number;
  enableVariations: boolean;
  sendPaused: boolean;
  countryCode: string;
  maxAttempts: number;
};

const DEFAULTS: LeadsSendSettings = {
  sendEnabled: true,
  sendDelayMinSec: 60,
  sendDelayMaxSec: 180,
  sendWindowStart: "09:00",
  sendWindowEnd: "20:00",
  sendOnWeekends: false,
  dailyLimit: 80,
  enableVariations: true,
  sendPaused: false,
  countryCode: "34",
  maxAttempts: 3
};

export async function getSendSettings(workspaceId: string): Promise<LeadsSendSettings> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const s: any = (ws?.settings as any)?.leads ?? {};
  return {
    sendEnabled: s.sendEnabled ?? DEFAULTS.sendEnabled,
    sendDelayMinSec: s.sendDelayMinSec ?? DEFAULTS.sendDelayMinSec,
    sendDelayMaxSec: s.sendDelayMaxSec ?? DEFAULTS.sendDelayMaxSec,
    sendWindowStart: s.sendWindowStart ?? DEFAULTS.sendWindowStart,
    sendWindowEnd: s.sendWindowEnd ?? DEFAULTS.sendWindowEnd,
    sendOnWeekends: s.sendOnWeekends ?? DEFAULTS.sendOnWeekends,
    dailyLimit: s.dailyLimit ?? DEFAULTS.dailyLimit,
    enableVariations: s.enableVariations ?? DEFAULTS.enableVariations,
    sendPaused: s.sendPaused ?? DEFAULTS.sendPaused,
    countryCode: s.whatsappCountryCode ?? DEFAULTS.countryCode,
    maxAttempts: s.maxAttempts ?? DEFAULTS.maxAttempts
  };
}

function parseHM(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map((n) => Number(n));
  return { h: Number.isFinite(h) ? h : 9, m: Number.isFinite(m) ? m : 0 };
}

/**
 * ¿La hora actual está dentro de la ventana de envío? (anti-baneo: no
 * enviar de madrugada ni en fin de semana si no está permitido). Usa la
 * hora local del servidor, igual que computeNextSlot, para que el cálculo
 * al encolar y al enviar sean coherentes.
 */
export function isInsideWindow(settings: LeadsSendSettings, now: Date = new Date()): boolean {
  const day = now.getDay(); // 0=Dom, 6=Sáb
  if (!settings.sendOnWeekends && (day === 0 || day === 6)) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = parseHM(settings.sendWindowStart);
  const end = parseHM(settings.sendWindowEnd);
  return cur >= start.h * 60 + start.m && cur < end.h * 60 + end.m;
}

/** Mensajes realmente ENVIADOS hoy (para el tope diario en el envío). */
export async function countSentToday(workspaceId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return prisma.leadMessage.count({
    where: { workspaceId, status: "sent", sentAt: { gte: dayStart, lt: dayEnd } }
  });
}

/**
 * Mueve `date` al siguiente slot válido respetando ventana, weekends y
 * daily limit. Devuelve la nueva fecha.
 */
export async function computeNextSlot(opts: {
  workspaceId: string;
  desired: Date;
  settings: LeadsSendSettings;
}): Promise<Date> {
  const { settings } = opts;
  const d = new Date(opts.desired);
  const win = { start: parseHM(settings.sendWindowStart), end: parseHM(settings.sendWindowEnd) };
  const minMinutes = win.start.h * 60 + win.start.m;
  const maxMinutes = win.end.h * 60 + win.end.m;

  // Empujar fuera de fin de semana si así está configurado
  function isWeekend(dt: Date) {
    const g = dt.getDay(); // 0=Dom, 6=Sab
    return g === 0 || g === 6;
  }
  while (!settings.sendOnWeekends && isWeekend(d)) {
    d.setDate(d.getDate() + 1);
    d.setHours(win.start.h, win.start.m, 0, 0);
  }

  // Si fuera de ventana → siguiente apertura
  const curMinutes = d.getHours() * 60 + d.getMinutes();
  if (curMinutes < minMinutes) {
    d.setHours(win.start.h, win.start.m, 0, 0);
  } else if (curMinutes >= maxMinutes) {
    d.setDate(d.getDate() + 1);
    d.setHours(win.start.h, win.start.m, 0, 0);
    if (!settings.sendOnWeekends && isWeekend(d)) {
      // recursión sencilla: añadir 1 día más mientras siga siendo finde
      while (isWeekend(d)) d.setDate(d.getDate() + 1);
    }
  }

  // Daily limit: contar mensajes enviados o programados para este día
  const dayStart = new Date(d);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const count = await prisma.leadMessage.count({
    where: {
      workspaceId: opts.workspaceId,
      OR: [
        { sentAt: { gte: dayStart, lt: dayEnd } },
        { scheduledAt: { gte: dayStart, lt: dayEnd }, status: { in: ["queued", "sending"] } }
      ]
    }
  });
  if (count >= settings.dailyLimit) {
    // Pasamos al día siguiente, hora de apertura
    d.setDate(d.getDate() + 1);
    d.setHours(win.start.h, win.start.m, 0, 0);
    while (!settings.sendOnWeekends && isWeekend(d)) d.setDate(d.getDate() + 1);
  }

  return d;
}

/**
 * Encola un mensaje para un lead.
 */
export async function enqueueMessage(opts: {
  workspaceId: string;
  leadId: string;
  body: string; // mensaje crudo, antes de variaciones
  templateId?: string | null;
}): Promise<{ messageId: string; scheduledAt: Date }> {
  const settings = await getSendSettings(opts.workspaceId);
  const lead = await prisma.lead.findFirst({
    where: { id: opts.leadId, workspaceId: opts.workspaceId },
    select: { id: true, phone: true, internationalPhone: true, contactStatus: true }
  });
  if (!lead) throw new Error("Lead no encontrado");
  if (["excluded", "discarded"].includes(lead.contactStatus)) {
    throw new Error("Lead excluido o descartado");
  }
  const rawPhone = lead.internationalPhone ?? lead.phone ?? null;
  const phone = normalizePhone(rawPhone, settings.countryCode);
  if (!phone) throw new Error("Lead sin teléfono");

  // Comprobar opt-out
  const optout = await prisma.leadOptout.findFirst({
    where: { workspaceId: opts.workspaceId, phone }
  });
  if (optout) throw new Error("Teléfono en opt-out");

  // No encolar si ya hay otro mensaje queued/sending para este lead
  const existing = await prisma.leadMessage.findFirst({
    where: { leadId: lead.id, status: { in: ["queued", "sending"] } }
  });
  if (existing) throw new Error("Ya hay un mensaje en cola para este lead");

  // Renderizar (placeholders ya resueltos por el caller? — re-resolvemos por seguridad)
  let rendered = opts.body;
  try {
    rendered = await renderTemplate({ workspaceId: opts.workspaceId, body: opts.body, leadId: lead.id });
  } catch {}

  // Aplicar variaciones
  if (settings.enableVariations) {
    rendered = varyMessage(rendered, lead.id);
  }

  // Calcular slot. ANTI-BANEO: encadenamos tras el ÚLTIMO mensaje ya
  // programado (no desde "ahora"), para que un alta masiva quede ESPACIADA
  // (uno cada delay min–max) en vez de amontonarse y dispararse en ráfaga
  // —que es justo lo que provoca el baneo del número.
  const lastScheduled = await prisma.leadMessage.findFirst({
    where: { workspaceId: opts.workspaceId, status: { in: ["queued", "sending"] } },
    orderBy: { scheduledAt: "desc" },
    select: { scheduledAt: true }
  });
  const nowMs = Date.now();
  const baseMs = Math.max(nowMs, lastScheduled?.scheduledAt?.getTime() ?? nowMs);
  const gapSec =
    settings.sendDelayMinSec +
    Math.random() * Math.max(0, settings.sendDelayMaxSec - settings.sendDelayMinSec);
  const desired = new Date(baseMs + gapSec * 1000);
  const scheduledAt = await computeNextSlot({
    workspaceId: opts.workspaceId,
    desired,
    settings
  });

  const msg = await prisma.leadMessage.create({
    data: {
      workspaceId: opts.workspaceId,
      leadId: lead.id,
      templateId: opts.templateId ?? null,
      renderedMessage: rendered,
      channel: "whatsapp",
      phoneNormalized: phone,
      status: "queued",
      scheduledAt
    }
  });

  return { messageId: msg.id, scheduledAt };
}

/**
 * Procesa 1 mensaje pendiente. Pensado para correr cada minuto por un cron.
 */
export async function processQueueTick(workspaceId: string): Promise<{
  processed: boolean;
  messageId?: string;
  status?: string;
  error?: string;
}> {
  const settings = await getSendSettings(workspaceId);
  if (!settings.sendEnabled || settings.sendPaused) {
    return { processed: false, error: "queue_paused" };
  }

  // ANTI-BANEO en el momento de enviar (red de seguridad además del
  // scheduledAt encadenado), espejo de NVL_Send_Queue::next_ready_message:
  const now = new Date();
  // 1) Ventana horaria + fines de semana: nunca enviar fuera de horas humanas.
  if (!isInsideWindow(settings, now)) {
    return { processed: false, error: "outside_window" };
  }
  // 2) Tope diario REAL: contar mensajes ya enviados hoy (no solo programados).
  const sentToday = await countSentToday(workspaceId);
  if (sentToday >= settings.dailyLimit) {
    return { processed: false, error: "daily_limit_reached" };
  }
  // 3) Cadencia mínima desde el último envío real: aunque haya varios
  //    mensajes vencidos en cola, respeta el delay mínimo entre envíos.
  const lastSent = await prisma.leadMessage.findFirst({
    where: { workspaceId, status: "sent", sentAt: { not: null } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true }
  });
  if (lastSent?.sentAt) {
    const elapsedSec = (now.getTime() - lastSent.sentAt.getTime()) / 1000;
    if (elapsedSec < settings.sendDelayMinSec) {
      return { processed: false, error: "pacing_wait" };
    }
  }

  const msg = await prisma.leadMessage.findFirst({
    where: {
      workspaceId,
      status: "queued",
      scheduledAt: { lte: now }
    },
    orderBy: { scheduledAt: "asc" }
  });
  if (!msg) return { processed: false };

  await prisma.leadMessage.update({
    where: { id: msg.id },
    data: { status: "sending", sendAttempts: msg.sendAttempts + 1 }
  });

  try {
    const cfg = await getWahaConfig(workspaceId);
    const out = await sendText({
      workspaceId,
      phoneNormalized: msg.phoneNormalized,
      text: msg.renderedMessage,
      session: msg.instanceName ?? cfg.session
    });
    await prisma.leadMessage.update({
      where: { id: msg.id },
      data: { status: "sent", sentAt: new Date(), externalMessageId: out.messageId }
    });
    // Marcar lead como contacted
    await prisma.lead.updateMany({
      where: { id: msg.leadId, contactStatus: "pending" },
      data: { contactStatus: "contacted" }
    });
    return { processed: true, messageId: msg.id, status: "sent" };
  } catch (e: any) {
    const newAttempts = msg.sendAttempts + 1;
    const maxed = newAttempts >= settings.maxAttempts;
    await prisma.leadMessage.update({
      where: { id: msg.id },
      data: {
        status: maxed ? "failed" : "queued",
        lastError: String(e?.message ?? e).slice(0, 500),
        scheduledAt: maxed ? msg.scheduledAt : new Date(Date.now() + 30 * 60 * 1000) // +30min
      }
    });
    return { processed: true, messageId: msg.id, status: maxed ? "failed" : "retry", error: e?.message };
  }
}
