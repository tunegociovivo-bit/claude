/**
 * Send Queue: encolar mensajes, calcular `scheduledAt` respetando ventana
 * horaria, delays y daily limit. Procesar la cola (1 mensaje por tick).
 *
 * Migra NVL_Send_Queue.
 */

import { prisma } from "@/lib/db/prisma";
import { renderTemplate } from "./template-engine";
import { aiRewriteMessage } from "./ai-vary";
import { normalizePhone, sendText, getWahaConfig, checkNumberExists } from "./waha";
import { pickEnqueueChannel, reassignIfQuarantined } from "./channels";

/**
 * Estados que cuentan como "ya enviado" para los topes anti-baneo. Cuando el
 * webhook de WAHA confirma la entrega, un mensaje "sent" pasa a "delivered" o
 * "read"; deben seguir contando o el pacing creería que se envió de menos y
 * dispararía ráfagas (justo lo que provoca baneos).
 */
export const SENT_STATUSES = ["sent", "delivered", "read"];

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
  // ── ANTI-BANEO REFORZADO ──
  /** Máx mensajes enviados por hora (no solo por día). Evita ráfagas que
   *  WhatsApp detecta como bot. */
  maxPerHour: number;
  /** Mínimo de días entre dos mensajes al MISMO número. Evita rebotes,
   *  doble-contacto entre campañas distintas y mejora reputación. */
  minCoolDownDaysPerRecipient: number;
  /** Cap de "nuevas conversaciones" iniciadas hoy. WhatsApp vigila esto
   *  más que el volumen total: empezar muchas convos nuevas con el mismo
   *  copy = bandera roja. */
  maxNewChatsPerDay: number;
  /** Modo recuperación post-restricción. Si true, aplica límites mucho
   *  más conservadores durante recoveryDurationDays. Después se auto-
   *  desactiva. */
  recoveryMode: boolean;
  recoverySince: string | null; // ISO date
  recoveryDurationDays: number;
  // ── WARMUP (calentamiento de número nuevo) ──
  /** Si true, el tope diario crece poco a poco durante los primeros días de
   *  uso del número, en vez de empezar mandando al máximo (lo que banea
   *  números nuevos). */
  warmupEnabled: boolean;
  /** Días que dura la rampa hasta llegar al dailyLimit configurado. */
  warmupDays: number;
  /** Tope del primer día. */
  warmupStartCap: number;
  // ── AUTO-RECUPERACIÓN ──
  /** Si detecta un pico de fallos de envío (señal típica de restricción),
   *  activa solo el modo recuperación automáticamente. */
  autoRecoveryEnabled: boolean;
  // ── JITTER ──
  /** Reduce el tope diario un % aleatorio (0–pct) distinto cada día, para que
   *  el volumen no sea idéntico a diario (patrón que delata un bot). */
  dailyJitterPct: number;
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
  validateWaBeforeSend: true,
  maxPerHour: 10,
  minCoolDownDaysPerRecipient: 7,
  maxNewChatsPerDay: 25,
  recoveryMode: false,
  recoverySince: null,
  recoveryDurationDays: 14,
  warmupEnabled: true,
  warmupDays: 21,
  warmupStartCap: 10,
  autoRecoveryEnabled: true,
  dailyJitterPct: 0.15
};

/** Límites endurecidos durante el modo recuperación. Se aplican encima de
 *  los settings del usuario tomando siempre el valor MÁS conservador. */
const RECOVERY_OVERRIDES = {
  sendDelayMinSec: 300, // 5 min
  sendDelayMaxSec: 900, // 15 min
  dailyLimit: 15,
  maxPerHour: 3,
  maxNewChatsPerDay: 8,
  minCoolDownDaysPerRecipient: 10
};

export async function getSendSettings(workspaceId: string): Promise<LeadsSendSettings> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const s: any = (ws?.settings as any)?.leads ?? {};
  const base: LeadsSendSettings = {
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
    validateWaBeforeSend: s.validateWaBeforeSend ?? DEFAULTS.validateWaBeforeSend,
    maxPerHour: s.maxPerHour ?? DEFAULTS.maxPerHour,
    minCoolDownDaysPerRecipient: s.minCoolDownDaysPerRecipient ?? DEFAULTS.minCoolDownDaysPerRecipient,
    maxNewChatsPerDay: s.maxNewChatsPerDay ?? DEFAULTS.maxNewChatsPerDay,
    recoveryMode: s.recoveryMode ?? DEFAULTS.recoveryMode,
    recoverySince: s.recoverySince ?? DEFAULTS.recoverySince,
    recoveryDurationDays: s.recoveryDurationDays ?? DEFAULTS.recoveryDurationDays,
    warmupEnabled: s.warmupEnabled ?? DEFAULTS.warmupEnabled,
    warmupDays: s.warmupDays ?? DEFAULTS.warmupDays,
    warmupStartCap: s.warmupStartCap ?? DEFAULTS.warmupStartCap,
    autoRecoveryEnabled: s.autoRecoveryEnabled ?? DEFAULTS.autoRecoveryEnabled,
    dailyJitterPct: s.dailyJitterPct ?? DEFAULTS.dailyJitterPct
  };

  // Auto-desactiva recoveryMode al pasar el plazo (recoveryDurationDays
  // desde recoverySince). Persistimos para que la UI lo vea apagado.
  if (base.recoveryMode && base.recoverySince) {
    const expires =
      new Date(base.recoverySince).getTime() + base.recoveryDurationDays * 86_400_000;
    if (Date.now() > expires) {
      base.recoveryMode = false;
      await prisma.workspace
        .update({
          where: { id: workspaceId },
          data: {
            settings: {
              ...((ws?.settings as any) ?? {}),
              leads: { ...(s ?? {}), recoveryMode: false }
            }
          }
        })
        .catch(() => {});
    }
  }

  // Si recoveryMode sigue activo, aplica overrides (siempre escogiendo el
  // valor MÁS conservador entre user y override — el user no puede
  // aflojarlos durante la recuperación).
  if (base.recoveryMode) {
    base.sendDelayMinSec = Math.max(base.sendDelayMinSec, RECOVERY_OVERRIDES.sendDelayMinSec);
    base.sendDelayMaxSec = Math.max(base.sendDelayMaxSec, RECOVERY_OVERRIDES.sendDelayMaxSec);
    base.dailyLimit = Math.min(base.dailyLimit, RECOVERY_OVERRIDES.dailyLimit);
    base.maxPerHour = Math.min(base.maxPerHour, RECOVERY_OVERRIDES.maxPerHour);
    base.maxNewChatsPerDay = Math.min(base.maxNewChatsPerDay, RECOVERY_OVERRIDES.maxNewChatsPerDay);
    base.minCoolDownDaysPerRecipient = Math.max(
      base.minCoolDownDaysPerRecipient,
      RECOVERY_OVERRIDES.minCoolDownDaysPerRecipient
    );
  }

  // WARMUP: durante los primeros días de vida del número, el tope diario sube
  // en rampa desde warmupStartCap hasta el dailyLimit configurado. La "edad"
  // del número se aproxima por el primer mensaje enviado del workspace.
  if (base.warmupEnabled) {
    const cap = await computeWarmupCap(workspaceId, base);
    base.dailyLimit = Math.min(base.dailyLimit, cap);
  }

  // JITTER: resta un % aleatorio (determinístico por día de Madrid) al tope
  // diario, para que el volumen no sea idéntico cada día.
  if (base.dailyJitterPct > 0) {
    const mp = getMadridParts(new Date());
    const seed = mp.year * 10000 + mp.month * 100 + mp.day;
    const frac = ((seed * 9301 + 49297) % 233280) / 233280; // 0..1 estable por día
    const reduction = base.dailyLimit * base.dailyJitterPct * frac;
    base.dailyLimit = Math.max(1, Math.round(base.dailyLimit - reduction));
  }

  // MULTI-NÚMERO: los topes anti-baneo (diario, por hora, nuevas conversaciones)
  // son POR NÚMERO. El principal + los números extra activos reparten el volumen,
  // así que el tope del WORKSPACE es la SUMA: con N números, N× envíos/día. El
  // reparto del enqueue (pickEnqueueChannel) distribuye entre todos, de modo que
  // cada número se mantiene dentro de su propio cupo (anti-baneo intacto).
  const extraChannels = Array.isArray(s.channels)
    ? s.channels.filter(
        (c: any) => c && typeof c.name === "string" && c.name.trim() && c.active !== false
      ).length
    : 0;
  const senders = 1 + extraChannels; // principal + extra
  if (senders > 1) {
    base.dailyLimit = base.dailyLimit * senders;
    base.maxPerHour = base.maxPerHour * senders;
    base.maxNewChatsPerDay = base.maxNewChatsPerDay * senders;
  }

  return base;
}

/** Tope diario efectivo según el "calentamiento" del número. */
async function computeWarmupCap(workspaceId: string, settings: LeadsSendSettings): Promise<number> {
  const first = await prisma.leadMessage.findFirst({
    where: { workspaceId, status: { in: SENT_STATUSES }, sentAt: { not: null } },
    orderBy: { sentAt: "asc" },
    select: { sentAt: true }
  });
  if (!first?.sentAt) return settings.warmupStartCap; // aún no se ha enviado nada
  const dayIndex = Math.floor((Date.now() - first.sentAt.getTime()) / 86_400_000) + 1;
  if (dayIndex >= settings.warmupDays) return settings.dailyLimit;
  const ramp =
    settings.warmupStartCap +
    ((settings.dailyLimit - settings.warmupStartCap) * (dayIndex - 1)) /
      Math.max(1, settings.warmupDays - 1);
  return Math.max(settings.warmupStartCap, Math.min(settings.dailyLimit, Math.round(ramp)));
}

/** Activa el modo recuperación persistiéndolo en settings. */
async function enableRecoveryMode(workspaceId: string): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings: any = ws?.settings ?? {};
  settings.leads = settings.leads ?? {};
  settings.leads.recoveryMode = true;
  settings.leads.recoverySince = new Date().toISOString();
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } }).catch(() => {});
}

/**
 * Detecta un posible bloqueo/restricción del número por un pico de fallos y
 * activa el modo recuperación automáticamente. Heurística sin migración: si
 * de los últimos mensajes procesados una proporción alta acabó en "failed",
 * algo va mal (número limitado, sesión caída, IP marcada).
 */
async function maybeAutoRecover(workspaceId: string, settings: LeadsSendSettings): Promise<boolean> {
  if (!settings.autoRecoveryEnabled || settings.recoveryMode) return false;
  const recent = await prisma.leadMessage.findMany({
    where: { workspaceId, status: { in: [...SENT_STATUSES, "failed"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { status: true }
  });
  if (recent.length < 8) return false;
  const failed = recent.filter((m) => m.status === "failed").length;
  if (failed >= Math.ceil(recent.length * 0.5)) {
    await enableRecoveryMode(workspaceId);
    return true;
  }
  return false;
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
    where: { workspaceId, status: { in: SENT_STATUSES }, sentAt: { gte: dayStart, lt: dayEnd } }
  });
}

/** Mensajes enviados en los últimos N minutos (cap por hora anti-baneo). */
export async function countSentInWindow(workspaceId: string, minutes: number): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000);
  return prisma.leadMessage.count({
    where: { workspaceId, status: { in: SENT_STATUSES }, sentAt: { gte: since } }
  });
}

/** Cuántas NUEVAS conversaciones se han abierto hoy (Madrid). Una nueva
 *  conversación = un mensaje "sent" cuyo phoneNormalized no había recibido
 *  ningún mensaje sent antes. Aproximación: contamos `phoneNormalized`s
 *  cuyo primer "sent" cae dentro de hoy. */
export async function countNewConversationsToday(workspaceId: string): Promise<number> {
  const mp = getMadridParts(new Date());
  const dayStart = madridWallToDate(mp.year, mp.month, mp.day, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const sentTodayPhones = await prisma.leadMessage.findMany({
    where: { workspaceId, status: { in: SENT_STATUSES }, sentAt: { gte: dayStart, lt: dayEnd } },
    select: { phoneNormalized: true },
    distinct: ["phoneNormalized"]
  });
  if (sentTodayPhones.length === 0) return 0;
  // Una sola query: de esos teléfonos, ¿cuáles ya habían recibido un envío
  // antes de hoy? Los que NO, son conversaciones nuevas. (Antes era una query
  // por teléfono — N+1 — y con cientos de envíos podía agotar el tiempo del
  // tick y saltarse el límite anti-baneo.)
  const phones = sentTodayPhones.map((p) => p.phoneNormalized);
  const priorPhones = await prisma.leadMessage.findMany({
    where: {
      workspaceId,
      status: { in: SENT_STATUSES },
      phoneNormalized: { in: phones },
      sentAt: { lt: dayStart }
    },
    select: { phoneNormalized: true },
    distinct: ["phoneNormalized"]
  });
  const hadPrior = new Set(priorPhones.map((p) => p.phoneNormalized));
  return phones.filter((p) => !hadPrior.has(p)).length;
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

  // Aplicar variaciones: cada mensaje se reescribe con IA para que dos leads
  // nunca reciban texto idéntico (anti-spam Meta) y para mejorar el formato
  // visual en WhatsApp (párrafos, CTA, líneas cortas). Si la IA falla cae al
  // varyMessage determinístico para no bloquear el envío.
  if (settings.enableVariations) {
    rendered = await aiRewriteMessage({
      workspaceId: opts.workspaceId,
      base: rendered,
      seed: lead.id
    });
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

  // Multi-número: reparte el envío entre los números configurados (null si no
  // hay multi-número → comportamiento por defecto). El bucle de envío ya
  // respeta msg.instanceName.
  const channel = await pickEnqueueChannel(opts.workspaceId);

  const msg = await prisma.leadMessage.create({
    data: {
      workspaceId: opts.workspaceId,
      leadId: lead.id,
      templateId: opts.templateId ?? null,
      renderedMessage: rendered,
      channel: "whatsapp",
      phoneNormalized: phone,
      status: "queued",
      scheduledAt,
      instanceName: channel ?? undefined
    }
  });

  return { messageId: msg.id, scheduledAt };
}

/**
 * Re-pagina (reprograma) los mensajes en cola distribuyéndolos de nuevo a
 * partir de `from` (por defecto, ahora), respetando ventana horaria, fines de
 * semana, tope diario y el mismo espaciado anti-baneo que el alta normal.
 *
 * Caso de uso: una búsqueda nueva encola sus mensajes ENCADENADOS tras el
 * último ya programado, así que si había backlog quedan a varios días vista
 * ("no se envía nada hasta el día 15"). Esto los adelanta para empezar ya.
 *
 * Si se pasan `ids`, solo re-pagina esos; si no, TODOS los queued del
 * workspace. Procesa en orden cronológico actual para preservar prioridades.
 */
export async function repaceQueue(opts: {
  workspaceId: string;
  ids?: string[];
  from?: Date;
}): Promise<{ updated: number; firstAt: Date | null; lastAt: Date | null }> {
  const settings = await getSendSettings(opts.workspaceId);

  const where: any = { workspaceId: opts.workspaceId, status: "queued" };
  if (opts.ids && opts.ids.length) where.id = { in: opts.ids };

  const msgs = await prisma.leadMessage.findMany({
    where,
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    select: { id: true }
  });
  if (msgs.length === 0) return { updated: 0, firstAt: null, lastAt: null };

  // Apartamos temporalmente los mensajes a re-paginar (scheduledAt = null) para
  // que computeNextSlot NO los cuente en su posición vieja (futura) al aplicar
  // el tope diario. Sus cupos se reconstruyen a medida que les asignamos slot.
  await prisma.leadMessage.updateMany({
    where: { id: { in: msgs.map((m) => m.id) }, workspaceId: opts.workspaceId },
    data: { scheduledAt: null }
  });

  const baseMs = Math.max(Date.now(), opts.from?.getTime() ?? Date.now());
  let prevAssigned = new Date(baseMs);
  let isFirst = true;
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;
  let updated = 0;

  for (const m of msgs) {
    const gapSec =
      settings.sendDelayMinSec +
      Math.random() * Math.max(0, settings.sendDelayMaxSec - settings.sendDelayMinSec);
    const desired = isFirst ? new Date(baseMs) : new Date(prevAssigned.getTime() + gapSec * 1000);
    const slot = await computeNextSlot({ workspaceId: opts.workspaceId, desired, settings });
    await prisma.leadMessage.update({
      where: { id: m.id },
      data: { scheduledAt: slot }
    });
    prevAssigned = slot;
    if (!firstAt) firstAt = slot;
    lastAt = slot;
    isFirst = false;
    updated++;
  }

  return { updated, firstAt, lastAt };
}

/**
 * Reprograma UN mensaje concreto a la fecha exacta indicada (sin re-paginar el
 * resto). Para ajustes finos manuales desde la UI.
 */
export async function rescheduleMessage(opts: {
  workspaceId: string;
  id: string;
  scheduledAt: Date;
}): Promise<{ id: string; scheduledAt: Date }> {
  const msg = await prisma.leadMessage.findFirst({
    where: { id: opts.id, workspaceId: opts.workspaceId },
    select: { id: true, status: true }
  });
  if (!msg) throw new Error("Mensaje no encontrado");
  if (msg.status !== "queued") {
    throw new Error(`Solo se puede reprogramar un mensaje en cola (estado actual: ${msg.status})`);
  }
  await prisma.leadMessage.update({
    where: { id: opts.id },
    data: { scheduledAt: opts.scheduledAt }
  });
  return { id: opts.id, scheduledAt: opts.scheduledAt };
}
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

  // ANTI-BANEO: si hay un pico de fallos, activa el modo recuperación solo y
  // salta este tick (el siguiente ya aplicará los límites endurecidos).
  if (await maybeAutoRecover(workspaceId, settings)) {
    return { processed: false, error: "auto_recovery_triggered" };
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
  // 3) Cap por hora — ANTI-BANEO: incluso si el daily lo permite, evitamos
  //    ráfagas que dispararían las alertas de Meta.
  const sentLastHour = await countSentInWindow(workspaceId, 60);
  if (sentLastHour >= settings.maxPerHour) {
    return { processed: false, error: "hourly_limit_reached" };
  }
  // 4) Cadencia mínima desde el último envío real: aunque haya varios
  //    mensajes vencidos en cola, respeta el delay mínimo entre envíos.
  const lastSent = await prisma.leadMessage.findFirst({
    where: { workspaceId, status: { in: SENT_STATUSES }, sentAt: { not: null } },
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

  // 5) Cool-down POR DESTINATARIO: no contactar dos veces al mismo número
  //    dentro de la ventana configurada (default 7 días). Re-encolamos el
  //    mensaje para más tarde y seguimos al siguiente; no es un fallo del
  //    propio envío.
  const cooldownDays = settings.minCoolDownDaysPerRecipient;
  if (cooldownDays > 0) {
    const cutoff = new Date(now.getTime() - cooldownDays * 86_400_000);
    const recent = await prisma.leadMessage.findFirst({
      where: {
        workspaceId,
        phoneNormalized: msg.phoneNormalized,
        id: { not: msg.id },
        status: { in: SENT_STATUSES },
        sentAt: { gte: cutoff }
      },
      select: { sentAt: true }
    });
    if (recent) {
      const nextAllowed = new Date(
        (recent.sentAt?.getTime() ?? now.getTime()) + cooldownDays * 86_400_000
      );
      await prisma.leadMessage.update({
        where: { id: msg.id },
        data: { scheduledAt: nextAllowed }
      });
      return { processed: false, error: "recipient_cooldown" };
    }
  }

  // 6) Cap de NUEVAS conversaciones por día. Una "nueva conversación" es
  //    un envío a un número al que no se le había escrito antes. Meta
  //    vigila este número más que el volumen total: si abres 80 chats
  //    nuevos en un día, te marcan como bot.
  const earlierToThisPhone = await prisma.leadMessage.findFirst({
    where: {
      workspaceId,
      phoneNormalized: msg.phoneNormalized,
      id: { not: msg.id },
      status: { in: SENT_STATUSES }
    },
    select: { id: true }
  });
  const isNewConversation = !earlierToThisPhone;
  if (isNewConversation) {
    // Si la cuenta fallara (DB saturada), asumimos el peor caso (límite
    // alcanzado): mejor retrasar un envío que saltarse el límite anti-baneo.
    const newChatsToday = await countNewConversationsToday(workspaceId).catch((e) => {
      console.error("[send-queue] countNewConversationsToday falló, aplico límite por seguridad:", e?.message ?? e);
      return Number.MAX_SAFE_INTEGER;
    });
    if (newChatsToday >= settings.maxNewChatsPerDay) {
      // Reprograma este mensaje al primer slot de mañana en ventana.
      const tomorrowSlot = await computeNextSlot({
        workspaceId,
        desired: new Date(now.getTime() + 1 * 60_000),
        settings
      });
      const tomorrow = new Date(tomorrowSlot.getTime() + 24 * 60 * 60 * 1000);
      await prisma.leadMessage.update({
        where: { id: msg.id },
        data: { scheduledAt: tomorrow }
      });
      return { processed: false, error: "new_chats_daily_cap" };
    }
  }

  return sendMessageById(workspaceId, msg.id, { settings });
}

/**
 * Envía un mensaje concreto YA, saltándose ventana/scheduledAt/pacing.
 * Útil para pruebas manuales desde la UI ("⚡ Enviar ahora"). Sigue
 * respetando la validación WhatsApp y la conexión WAHA/Evolution.
 */
export async function sendMessageById(
  workspaceId: string,
  messageId: string,
  ctx?: { settings?: LeadsSendSettings }
): Promise<{ processed: boolean; messageId?: string; status?: string; error?: string }> {
  const settings = ctx?.settings ?? (await getSendSettings(workspaceId));
  const msg = await prisma.leadMessage.findFirst({
    where: { workspaceId, id: messageId }
  });
  if (!msg) return { processed: false, error: "not_found" };
  if (msg.status !== "queued") {
    return { processed: false, error: `estado actual: ${msg.status}` };
  }

  await prisma.leadMessage.update({
    where: { id: msg.id },
    data: { status: "sending", sendAttempts: msg.sendAttempts + 1 }
  });

  // Rotación por salud: si el número asignado está en cuarentena (quemado o
  // sesión caída), el mensaje sale por otro canal sano en vez de quemarse.
  try {
    const alt = await reassignIfQuarantined(workspaceId, msg.instanceName);
    if (alt) {
      console.warn(`[send-queue] canal "${msg.instanceName}" en cuarentena; mensaje ${msg.id} reasignado a "${alt}"`);
      msg.instanceName = alt;
      await prisma.leadMessage.update({ where: { id: msg.id }, data: { instanceName: alt } });
    }
  } catch {
    // La salud es best-effort: si falla, se envía por el canal original.
  }

  try {
    const cfg = await getWahaConfig(workspaceId);
    if (settings.validateWaBeforeSend) {
      const exists = await checkNumberExists({
        workspaceId,
        phone: msg.phoneNormalized,
        session: msg.instanceName ?? cfg.session
      });
      // El pre-check de WhatsApp (WAHA contacts/check-exists) da FALSOS
      // NEGATIVOS con algunos motores (NOWEB, o contactos aún sin
      // sincronizar): devuelve numberExists:false para móviles que SÍ tienen
      // WhatsApp, lo que descartaba campañas enteras. Solo tratamos el
      // "false" como definitivo en números que NO parecen móvil español
      // (fijos 9xx/8xx, que rara vez tienen WhatsApp). En móviles ES (6xx/7xx)
      // dejamos que el ENVÍO real decida — si no tiene WhatsApp, sendText
      // fallará y se marcará con el error real.
      const isEsMobile = /^34[67]\d{8}$/.test(msg.phoneNormalized);
      if (exists === false && !isEsMobile) {
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
      // Solo forzamos sesión/instancia si el mensaje tiene canal asignado
      // (multi-número). Si no, cada proveedor usa su propia por defecto
      // (WAHA → su sesión; Evolution → su instancia).
      session: msg.instanceName ?? undefined
    });
    await prisma.leadMessage.update({
      where: { id: msg.id },
      data: { status: "sent", sentAt: new Date(), externalMessageId: out.messageId }
    });
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
        scheduledAt: maxed ? msg.scheduledAt : new Date(Date.now() + 30 * 60 * 1000)
      }
    });
    return { processed: true, messageId: msg.id, status: maxed ? "failed" : "retry", error: e?.message };
  }
}
