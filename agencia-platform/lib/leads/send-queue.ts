/**
 * Send Queue: encolar mensajes, calcular `scheduledAt` respetando ventana
 * horaria, delays y daily limit. Procesar la cola (1 mensaje por tick).
 *
 * Migra NVL_Send_Queue.
 */

import { prisma } from "@/lib/db/prisma";
import { renderTemplate } from "./template-engine";
import { aiRewriteMessage } from "./ai-vary";
import { normalizePhone, sendText, sendImage, sendVoice, getWahaConfig, getSession, checkNumberExists } from "./waha";
import { generateVoiceMp3 } from "./voice-tts";
import { pickEnqueueChannel, reassignIfQuarantined, getLeadChannels, warmupReroute } from "./channels";
import { getCompetitorRanking, rankingAutoCaption } from "./competitors";
import { renderRankingPng } from "./ranking-card";

/** ¿La sesión WAHA está conectada (WORKING)? null si no se puede determinar. */
async function sessionWorking(workspaceId: string, session: string): Promise<boolean | null> {
  try {
    const s = await getSession({ workspaceId, session });
    const st = String((s as any)?.status ?? "").toUpperCase();
    if (!st) return null;
    return st === "WORKING";
  } catch {
    return null;
  }
}

/** Errores de WAHA que indican que la sesión no está lista (no es un fallo del
 *  mensaje): no deben quemar intentos, sino reintentarse al reconectar. */
const SESSION_DOWN_RE = /not\s*working|SCAN_QR|STARTING|STOPPED|FAILED|session.*(not|stopped|failed|status)/i;

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
  /** Fecha de "nacimiento" del número PRINCIPAL a efectos de calentamiento.
   *  Se sella al conectar o cambiar el número principal (típico tras un baneo:
   *  enchufas otra SIM). Así un número nuevo re-caliente desde el arranque en
   *  vez de heredar la antigüedad del workspace y salir enviando a tope. */
  principalSince: string | null;
  // ── AUTO-RECUPERACIÓN ──
  /** Si detecta un pico de fallos de envío (señal típica de restricción),
   *  activa solo el modo recuperación automáticamente. */
  autoRecoveryEnabled: boolean;
  // ── JITTER ──
  /** Reduce el tope diario un % aleatorio (0–pct) distinto cada día, para que
   *  el volumen no sea idéntico a diario (patrón que delata un bot). */
  dailyJitterPct: number;
  /** No enviar el PRIMER mensaje a un número si contiene un enlace. Un link en
   *  el primer contacto en frío es uno de los mayores disparadores de la marca
   *  de spam de WhatsApp. El mensaje queda como "blocked_link" (no se envía y no
   *  cuenta como fallo) para que se corrija el opener. */
  blockLinksInFirstMessage: boolean;
};

/** Detecta un enlace en el texto (http/https, www., o dominio.tld[/ruta]) con
 *  una lista acotada de TLDs comunes para minimizar falsos positivos. */
export function containsLink(text: string): boolean {
  if (!text) return false;
  const tlds =
    "com|es|net|org|io|app|xyz|link|me|info|biz|co|shop|store|online|site|gg|to|ly|page|dev|club";
  const re = new RegExp(
    `(https?:\\/\\/\\S+|www\\.\\S+|\\b[a-z0-9-]+\\.(?:${tlds})(?:\\/\\S*)?\\b)`,
    "i"
  );
  return re.test(text);
}

const DEFAULTS: LeadsSendSettings = {
  sendEnabled: true,
  sendDelayMinSec: 60,
  sendDelayMaxSec: 180,
  sendWindowStart: "09:00",
  sendWindowEnd: "20:00",
  sendOnWeekends: false,
  dailyLimit: 60,
  enableVariations: true,
  sendPaused: false,
  countryCode: "34",
  maxAttempts: 3,
  validateWaBeforeSend: true,
  maxPerHour: 10,
  minCoolDownDaysPerRecipient: 7,
  maxNewChatsPerDay: 10,
  recoveryMode: false,
  recoverySince: null,
  recoveryDurationDays: 14,
  warmupEnabled: true,
  warmupDays: 45,
  warmupStartCap: 3,
  principalSince: null,
  autoRecoveryEnabled: true,
  dailyJitterPct: 0.15,
  blockLinksInFirstMessage: true
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
    principalSince: s.principalSince ?? DEFAULTS.principalSince,
    autoRecoveryEnabled: s.autoRecoveryEnabled ?? DEFAULTS.autoRecoveryEnabled,
    dailyJitterPct: s.dailyJitterPct ?? DEFAULTS.dailyJitterPct,
    blockLinksInFirstMessage: s.blockLinksInFirstMessage ?? DEFAULTS.blockLinksInFirstMessage
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
    // Durante el calentamiento limitamos también los CHATS NUEVOS (primeros
    // contactos en frío), que es el principal factor de baneo de un número
    // nuevo — no solo el volumen total. Los ceñimos al tope bajo de la rampa.
    base.maxNewChatsPerDay = Math.min(base.maxNewChatsPerDay, cap);
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

  // CHATS EN FRÍO: abrir muchas conversaciones nuevas es el disparador de baneo
  // nº1 (más que el volumen total). Se mantiene SIEMPRE por debajo del volumen
  // diario: como máximo el 40% del tope efectivo del día. Así, aunque el usuario
  // suba maxNewChatsPerDay, nunca supera lo que un humano abriría en un día.
  base.maxNewChatsPerDay = Math.min(
    base.maxNewChatsPerDay,
    Math.max(1, Math.ceil(base.dailyLimit * 0.4))
  );

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
  // Fecha de "nacimiento" del número principal. Prioriza principalSince (se sella
  // al conectar/cambiar el número principal, típico tras un baneo) para que un
  // número nuevo re-caliente desde cero, en vez de heredar la antigüedad del
  // workspace y salir enviando a tope el día 1 (la causa del re-baneo).
  let birth = settings.principalSince ? Date.parse(settings.principalSince) : NaN;
  if (Number.isNaN(birth)) {
    const first = await prisma.leadMessage.findFirst({
      where: { workspaceId, status: { in: SENT_STATUSES }, sentAt: { not: null } },
      orderBy: { sentAt: "asc" },
      select: { sentAt: true }
    });
    if (!first?.sentAt) return settings.warmupStartCap; // aún no se ha enviado nada
    birth = first.sentAt.getTime();
  }
  const dayIndex = Math.floor((Date.now() - birth) / 86_400_000) + 1;
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
  body: string; // texto crudo, o pie de foto (ranking); puede ir vacío
  templateId?: string | null;
  /** "text" (defecto), "ranking" = imagen de posicionamiento, "voice" = nota de voz IA. */
  kind?: "text" | "ranking" | "voice";
  /** Permite encolar un 2º mensaje al mismo lead (p. ej. texto + luego imagen). */
  skipDuplicateCheck?: boolean;
}): Promise<{ messageId: string; scheduledAt: Date }> {
  const kind = opts.kind === "ranking" || opts.kind === "voice" ? opts.kind : "text";
  const settings = await getSendSettings(opts.workspaceId);
  const lead = await prisma.lead.findFirst({
    where: { id: opts.leadId, workspaceId: opts.workspaceId },
    select: {
      id: true, phone: true, internationalPhone: true, contactStatus: true,
      placeId: true, name: true, category: true, types: true, province: true,
      formattedAddress: true, address: true, latitude: true, longitude: true,
      rating: true, reviewsCount: true
    }
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

  // No encolar si ya hay otro mensaje queued/sending para este lead (salvo que
  // sea el 2º mensaje intencionado de un par texto+imagen).
  if (!opts.skipDuplicateCheck) {
    const existing = await prisma.leadMessage.findFirst({
      where: { leadId: lead.id, status: { in: ["queued", "sending"] } }
    });
    if (existing) throw new Error("Ya hay un mensaje en cola para este lead");
  }

  // Renderizar placeholders. Vale tanto para texto como para el PIE de la
  // imagen de ranking (texto + imagen): así el lead recibe la captura con un
  // mensaje personalizado ({{nombre}}, etc.). Si el cuerpo va vacío (ranking
  // sin plantilla) se deja "" y al enviar se usa un pie automático.
  // Snapshot del ranking: se calcula UNA vez aquí (kind ranking o si el texto
  // usa {{posicion}}/{{competidor_top}}) y se guarda en el mensaje, para que el
  // texto, la imagen y la preview usen EXACTAMENTE los mismos datos (el ranking
  // en vivo varía entre llamadas y descuadraba texto vs imagen).
  const needsRanking =
    kind === "ranking" || /\{\{\s*(posicion|competidor_top|competidores_por_delante)\s*\}\}/.test(opts.body);
  let rankingSnapshot: any = null;
  if (needsRanking) {
    try {
      rankingSnapshot = await getCompetitorRanking(opts.workspaceId, lead as any, { store: false, harvest: false });
    } catch {
      rankingSnapshot = null;
    }
  }

  let rendered = opts.body;
  if (rendered.trim()) {
    try {
      rendered = await renderTemplate({
        workspaceId: opts.workspaceId,
        body: opts.body,
        leadId: lead.id,
        ...(needsRanking ? { ranking: rankingSnapshot } : {})
      });
    } catch {}
    // Variaciones IA: evita texto idéntico entre leads (anti-spam) y mejora el
    // formato. Si falla, cae al texto renderizado.
    if (settings.enableVariations) {
      rendered = await aiRewriteMessage({
        workspaceId: opts.workspaceId,
        base: rendered,
        seed: lead.id
      });
    }
  }

  // Un mensaje de TEXTO nunca debe encolarse vacío (p. ej. una plantilla que
  // renderiza a nada por placeholders sin valor). Mejor saltarlo que enviar en
  // blanco. (En "ranking" el cuerpo vacío es válido → pie automático.)
  if ((kind === "text" || kind === "voice") && !rendered.trim()) {
    throw new Error("El mensaje quedó vacío al renderizar la plantilla (revisa la plantilla / placeholders)");
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
      kind,
      renderedMessage: rendered,
      rankingSnapshot: rankingSnapshot ?? undefined,
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

  // REPARTO MULTI-NÚMERO: al reprogramar, distribuimos los mensajes entre el
  // número PRINCIPAL (instanceName null) y los números extra activos (round-robin),
  // saltando los que estén en cuarentena. Así el volumen no recae en un solo
  // número (anti-baneo). Si no hay números extra, se deja el principal.
  let roster: (string | null)[] = [null];
  try {
    const { getLeadChannels, getChannelsHealthMap } = await import("./channels");
    const chans = (await getLeadChannels(opts.workspaceId)).filter((c) => c.active !== false);
    if (chans.length > 0) {
      const health = await getChannelsHealthMap(opts.workspaceId, chans);
      const usable = chans.filter((c) => health.get(c.name) !== "quarantined");
      roster = [null, ...usable.map((c) => c.name)];
    }
  } catch {
    roster = [null];
  }
  const distribute = roster.length > 1;

  let i = 0;
  for (const m of msgs) {
    const gapSec =
      settings.sendDelayMinSec +
      Math.random() * Math.max(0, settings.sendDelayMaxSec - settings.sendDelayMinSec);
    const desired = isFirst ? new Date(baseMs) : new Date(prevAssigned.getTime() + gapSec * 1000);
    const slot = await computeNextSlot({ workspaceId: opts.workspaceId, desired, settings });
    await prisma.leadMessage.update({
      where: { id: m.id },
      data: {
        scheduledAt: slot,
        ...(distribute ? { instanceName: roster[i % roster.length] } : {})
      }
    });
    prevAssigned = slot;
    if (!firstAt) firstAt = slot;
    lastAt = slot;
    isFirst = false;
    updated++;
    i++;
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
    // 6.0) ANTI-BANEO: nunca mandar un ENLACE en el PRIMER mensaje a un número.
    //      Un link en el opener en frío es de los mayores disparadores de la
    //      marca de spam de WhatsApp. Lo dejamos como "blocked_link" (no se
    //      envía y NO cuenta como fallo, para no disparar el modo recuperación)
    //      y no se reintenta: hay que quitar el link del opener.
    if (settings.blockLinksInFirstMessage && containsLink(msg.renderedMessage)) {
      await prisma.leadMessage.update({
        where: { id: msg.id },
        data: {
          status: "blocked_link",
          lastError:
            "Primer mensaje con enlace: bloqueado (anti-baneo). Quita el link del opener; mándalo tras la primera respuesta del lead."
        }
      });
      return { processed: false, error: "blocked_link_first_message" };
    }
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

  // Tope de CALENTAMIENTO al enviar: si el teléfono asignado ya agotó su cupo
  // diario (número nuevo o recién recuperado de un baneo), el mensaje sale por
  // otro número con hueco; si ninguno tiene, se aplaza a mañana. Así un número
  // frágil envía POCO aunque la cola le hubiera asignado muchos.
  try {
    const rr = await warmupReroute(workspaceId, msg.instanceName);
    if (rr && "defer" in rr) {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      await prisma.leadMessage.update({ where: { id: msg.id }, data: { status: "queued", scheduledAt: next } });
      return { processed: false, error: "warmup_cap_deferred" };
    }
    if (rr && "reassignTo" in rr) {
      console.warn(`[send-queue] canal "${msg.instanceName}" en warm-up al tope; mensaje ${msg.id} → "${rr.reassignTo ?? "Principal"}"`);
      msg.instanceName = rr.reassignTo;
      await prisma.leadMessage.update({ where: { id: msg.id }, data: { instanceName: rr.reassignTo } });
    }
  } catch {
    // best-effort: si falla, se envía por el canal original.
  }

  try {
    const cfg = await getWahaConfig(workspaceId);

    // GUARDA DE SESIÓN: antes de enviar, comprobar que el número asignado está
    // realmente CONECTADO en WAHA. Si no, reasignar a otro número conectado; si
    // ninguno lo está, dejar el mensaje EN COLA (sin quemar intentos) con un
    // aviso claro. Esto evita que toda una campaña falle (WAHA 422 "session not
    // working") cuando un número se desconecta.
    const preferred = msg.instanceName ?? cfg.session;
    const pref = await sessionWorking(workspaceId, preferred);
    if (pref === false) {
      const extraNames = (await getLeadChannels(workspaceId)).map((c) => c.name).filter(Boolean);
      const candidates = [cfg.session, ...extraNames].filter(
        (v, i, a) => v && v !== preferred && a.indexOf(v) === i
      );
      let chosen: string | null = null;
      for (const cand of candidates) {
        if ((await sessionWorking(workspaceId, cand)) === true) {
          chosen = cand;
          break;
        }
      }
      if (chosen) {
        msg.instanceName = chosen === cfg.session ? null : chosen;
        await prisma.leadMessage.update({ where: { id: msg.id }, data: { instanceName: msg.instanceName } });
      } else {
        await prisma.leadMessage.update({
          where: { id: msg.id },
          data: {
            status: "queued",
            sendAttempts: msg.sendAttempts, // no contar este intento (sesión caída ≠ fallo del mensaje)
            scheduledAt: new Date(Date.now() + 10 * 60 * 1000),
            lastError: `El número "${preferred}" no está conectado en WhatsApp y no hay otro conectado. Reconéctalo en Ajustes → Conectar; los mensajes se reintentan solos.`
          }
        });
        return { processed: false, messageId: msg.id, status: "no_session" };
      }
    }

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
    let out: { messageId: string; raw?: any };
    if ((msg as any).kind === "ranking") {
      // Imagen de posicionamiento: calcula el ranking del lead en Google (1
      // consulta a Places) y envía la "captura" como imagen con su pie. Si no
      // hay datos de ranking, lanza error → se reintenta/falla como el resto.
      const lead = await prisma.lead.findFirst({
        where: { id: msg.leadId, workspaceId },
        select: {
          id: true, placeId: true, name: true, category: true, types: true, province: true,
          formattedAddress: true, address: true, latitude: true, longitude: true,
          rating: true, reviewsCount: true
        }
      });
      if (!lead) throw new Error("Lead no encontrado para el ranking");
      // Usa el snapshot guardado al encolar (mismo dato que el texto/preview);
      // solo si no hay, consulta en vivo como reserva.
      const data =
        ((msg as any).rankingSnapshot as Awaited<ReturnType<typeof getCompetitorRanking>>) ||
        (await getCompetitorRanking(workspaceId, lead as any));
      if (!data) throw new Error("No se pudo obtener el ranking de Google (categoría/zona o API key de Places)");
      const png = await renderRankingPng(data);
      const caption = (msg.renderedMessage ?? "").trim() || rankingAutoCaption(data, lead.name);
      out = await sendImage({
        workspaceId,
        phoneNormalized: msg.phoneNormalized,
        imageBase64: png.toString("base64"),
        caption,
        session: msg.instanceName ?? undefined
      });
    } else if ((msg as any).kind === "voice") {
      // Nota de voz IA: genera el audio con ElevenLabs del texto del mensaje. Si
      // no hay config o falla la generación, cae a texto para no perder el toque.
      const audio = await generateVoiceMp3({ workspaceId, text: msg.renderedMessage });
      if (audio) {
        out = await sendVoice({
          workspaceId,
          phoneNormalized: msg.phoneNormalized,
          audio,
          session: msg.instanceName ?? undefined
        });
      } else {
        out = await sendText({
          workspaceId,
          phoneNormalized: msg.phoneNormalized,
          text: msg.renderedMessage,
          session: msg.instanceName ?? undefined
        });
      }
    } else {
      out = await sendText({
        workspaceId,
        phoneNormalized: msg.phoneNormalized,
        text: msg.renderedMessage,
        // Solo forzamos sesión/instancia si el mensaje tiene canal asignado
        // (multi-número). Si no, cada proveedor usa su propia por defecto
        // (WAHA → su sesión; Evolution → su instancia).
        session: msg.instanceName ?? undefined
      });
    }
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
    const errStr = String(e?.message ?? e);
    // Sesión caída (422 "session not working", etc.): NO es fallo del mensaje.
    // Lo devolvemos a la cola sin quemar intentos para que se reenvíe en cuanto
    // el número se reconecte, en vez de marcar la campaña entera como failed.
    if (SESSION_DOWN_RE.test(errStr)) {
      await prisma.leadMessage.update({
        where: { id: msg.id },
        data: {
          status: "queued",
          sendAttempts: msg.sendAttempts, // no contar este intento
          scheduledAt: new Date(Date.now() + 10 * 60 * 1000),
          lastError: `Número desconectado en WhatsApp — reintento al reconectar. (${errStr.slice(0, 160)})`
        }
      });
      return { processed: false, messageId: msg.id, status: "session_down" };
    }
    const newAttempts = msg.sendAttempts + 1;
    const maxed = newAttempts >= settings.maxAttempts;
    await prisma.leadMessage.update({
      where: { id: msg.id },
      data: {
        status: maxed ? "failed" : "queued",
        lastError: errStr.slice(0, 500),
        scheduledAt: maxed ? msg.scheduledAt : new Date(Date.now() + 30 * 60 * 1000)
      }
    });
    return { processed: true, messageId: msg.id, status: maxed ? "failed" : "retry", error: e?.message };
  }
}
