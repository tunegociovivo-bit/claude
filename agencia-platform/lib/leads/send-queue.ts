/**
 * Send Queue: encolar mensajes, calcular `scheduledAt` respetando ventana
 * horaria, delays y daily limit. Procesar la cola (1 mensaje por tick).
 *
 * Migra NVL_Send_Queue.
 */

import { prisma } from "@/lib/db/prisma";
import { renderTemplate, varyMessage } from "./template-engine";
import { normalizePhone, sendText, getWahaConfig, checkNumberExists } from "./waha";

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
  validateWaBeforeSend: boolean;
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
  maxAttempts: 3,
  validateWaBeforeSend: true
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
    maxAttempts: s.maxAttempts ?? DEFAULTS.maxAttempts,
    validateWaBeforeSend: s.validateWaBeforeSend ?? DEFAULTS.validateWaBeforeSend
  };
}

function parseHM(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map((n) => Number(n));
  return { h: Number.isFinite(h) ? h : 9, m: Number.isFinite(m) ? m : 0 };
}

/** Zona horaria de referencia para ventana de envío + tope diario. Hetzner /
 *  Railway funcionan en UTC; los usuarios piensan en hora local de Madrid. */
const TZ = "Europe/Madrid";

const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Hora-pared y día de la semana de `dt` proyectados a Europe/Madrid. */
function getMadridParts(dt: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(dt)) parts[p.type] = p.value;
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    dayOfWeek: WEEKDAYS_EN.indexOf(parts.weekday ?? "Mon")
  };
}

/** Devuelve el offset (minutos) entre Madrid y UTC en el instante `dt`. */
function getMadridOffsetMin(dt: Date): number {
  const m = getMadridParts(dt);
  const asUtc = Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute);
  const realUtc = Date.UTC(
    dt.getUTCFullYear(),
    dt.getUTCMonth(),
    dt.getUTCDate(),
    dt.getUTCHours(),
    dt.getUTCMinutes()
  );
  return Math.round((asUtc - realUtc) / 60_000);
}

/** Construye una Date (UTC) cuyo reloj-pared en Madrid sea {y, mo, d, h, m}. */
function madridWallToDate(y: number, mo: number, d: number, h: number, m: number): Date {
  // Guess inicial restando 2h (CEST). Si caemos en CET o en el cambio de hora
  // el offset real corrige en la segunda iteración.
  let guess = new Date(Date.UTC(y, mo - 1, d, h - 2, m, 0));
  for (let i = 0; i < 2; i++) {
    const offset = getMadridOffsetMin(guess);
    const desiredUtc = Date.UTC(y, mo - 1, d, h, m, 0) - offset * 60_000;
    if (desiredUtc === guess.getTime()) break;
    guess = new Date(desiredUtc);
  }
  return guess;
}

/**
 * ¿La hora actual está dentro de la ventana de envío? (anti-baneo: no
 * enviar de madrugada ni en fin de semana si no está permitido). Calcula
 * la hora en Europe/Madrid para que coincida con la que ve el usuario en
 * el navegador, no la UTC del servidor.
 */
export function isInsideWindow(settings: LeadsSendSettings, now: Date = new Date()): boolean {
  const m = getMadridParts(now);
  if (!settings.sendOnWeekends && (m.dayOfWeek === 0 || m.dayOfWeek === 6)) return false;
  const cur = m.hour * 60 + m.minute;
  const start = parseHM(settings.sendWindowStart);
  const end = parseHM(settings.sendWindowEnd);
  return cur >= start.h * 60 + start.m && cur < end.h * 60 + end.m;
}

/** Mensajes realmente ENVIADOS hoy (para el tope diario en el envío). Cuenta
 *  por día natural de Madrid, no por día UTC del servidor. */
export async function countSentToday(workspaceId: string): Promise<number> {
  const mp = getMadridParts(new Date());
  const dayStart = madridWallToDate(mp.year, mp.month, mp.day, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
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
  const win = { start: parseHM(settings.sendWindowStart), end: parseHM(settings.sendWindowEnd) };
  const minMinutes = win.start.h * 60 + win.start.m;
  const maxMinutes = win.end.h * 60 + win.end.m;

  // Trabajamos en reloj-pared de Madrid para que el slot que generemos
  // coincida con la ventana que el usuario configuró en hora local.
  let mp = getMadridParts(opts.desired);

  // Avanzar un día (Madrid) preservando hora de inicio.
  function rollToNextDayStart() {
    const next = madridWallToDate(mp.year, mp.month, mp.day, win.start.h, win.start.m);
    next.setTime(next.getTime() + 24 * 60 * 60 * 1000);
    mp = getMadridParts(next);
    mp.hour = win.start.h;
    mp.minute = win.start.m;
  }

  while (!settings.sendOnWeekends && (mp.dayOfWeek === 0 || mp.dayOfWeek === 6)) {
    rollToNextDayStart();
  }

  const curMinutes = mp.hour * 60 + mp.minute;
  if (curMinutes < minMinutes) {
    mp.hour = win.start.h;
    mp.minute = win.start.m;
  } else if (curMinutes >= maxMinutes) {
    rollToNextDayStart();
    while (!settings.sendOnWeekends && (mp.dayOfWeek === 0 || mp.dayOfWeek === 6)) {
      rollToNextDayStart();
    }
  }

  let d = madridWallToDate(mp.year, mp.month, mp.day, mp.hour, mp.minute);

  // Daily limit: contar mensajes enviados o programados para este día Madrid.
  const dayStart = madridWallToDate(mp.year, mp.month, mp.day, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

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
    rollToNextDayStart();
    while (!settings.sendOnWeekends && (mp.dayOfWeek === 0 || mp.dayOfWeek === 6)) {
      rollToNextDayStart();
    }
    d = madridWallToDate(mp.year, mp.month, mp.day, mp.hour, mp.minute);
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
    // Validación previa: no enviar a números que NO estén en WhatsApp (es
    // señal de spam y sube el riesgo de baneo). Solo descartamos ante un
    // "false" definitivo; si la comprobación falla (null) enviamos igual.
    if (settings.validateWaBeforeSend) {
      const exists = await checkNumberExists({
        workspaceId,
        phone: msg.phoneNormalized,
        session: msg.instanceName ?? cfg.session
      });
      if (exists === false) {
        await prisma.leadMessage.update({
          where: { id: msg.id },
          data: { status: "failed", lastError: "Número sin WhatsApp" }
        });
        await prisma.lead.update({
          where: { id: msg.leadId },
          data: { hasWhatsapp: false, whatsappChecked: true, whatsappCheckedAt: new Date() }
        });
        await prisma.lead.updateMany({
          where: { id: msg.leadId, contactStatus: "pending" },
          data: { contactStatus: "discarded" }
        });
        return { processed: true, messageId: msg.id, status: "no_whatsapp" };
      }
      if (exists === true) {
        await prisma.lead.update({
          where: { id: msg.leadId },
          data: { hasWhatsapp: true, whatsappChecked: true, whatsappCheckedAt: new Date() }
        });
      }
    }
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
