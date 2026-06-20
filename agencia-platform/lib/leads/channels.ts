/**
 * Multi-número de WhatsApp con reparto y salud. Un "canal" es un número/sesión
 * (WAHA) o instancia (Evolution) en el mismo servidor. Se configuran en
 * settings.leads.channels = [{ name, label?, dailyLimit?, active? }].
 *
 * El reparto se hace al ENCOLAR: a cada mensaje se le asigna el canal sano con
 * menos uso hoy que esté bajo su tope diario (load-balancing + anti-baneo).
 * Además, al ENVIAR se comprueba la salud: si el canal asignado está en
 * cuarentena (número quemado o sesión caída), el mensaje se reasigna a otro.
 *
 * Retrocompatible: con 0 canales configurados se devuelve null y todo funciona
 * como antes (sesión/instancia por defecto).
 */

import { prisma } from "@/lib/db/prisma";

export type LeadChannel = {
  name: string; // sesión WAHA o instancia Evolution
  label?: string;
  dailyLimit?: number;
  active?: boolean;
};

const DEFAULT_CHANNEL_DAILY_LIMIT = 50;

/**
 * Tope diario EFECTIVO de un canal según su calentamiento POR TELÉFONO.
 * Cada número arranca su propia rampa desde su `addedAt` (no desde la edad de
 * la cuenta), así un número nuevo en una cuenta antigua no envía a tope desde
 * el día 1 (la causa típica del baneo). Sin addedAt → se asume ya calentado.
 */
export function channelWarmupCap(channel: any, leads: any): { cap: number; warming: boolean; dayIndex: number; warmupDays: number } {
  const configured = channel?.dailyLimit ?? DEFAULT_CHANNEL_DAILY_LIMIT;
  const warmupDays = Number(leads?.warmupDays) || 21;
  const startCap = Math.min(Number(leads?.warmupStartCap) || 10, configured);
  const added = channel?.addedAt ? Date.parse(channel.addedAt) : NaN;
  if (leads?.warmupEnabled === false || !added || Number.isNaN(added)) {
    return { cap: configured, warming: false, dayIndex: warmupDays, warmupDays };
  }
  const dayIndex = Math.floor((Date.now() - added) / 86_400_000) + 1;
  if (dayIndex >= warmupDays) return { cap: configured, warming: false, dayIndex, warmupDays };
  const ramp = startCap + ((configured - startCap) * (dayIndex - 1)) / Math.max(1, warmupDays - 1);
  return { cap: Math.max(startCap, Math.min(configured, Math.round(ramp))), warming: true, dayIndex, warmupDays };
}

export async function getLeadChannels(workspaceId: string): Promise<LeadChannel[]> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const arr = (ws?.settings as any)?.leads?.channels;
  if (!Array.isArray(arr)) return [];
  return arr.filter((c: any) => c && typeof c.name === "string" && c.name.trim());
}

// ──────────────────────────────────────────────────────────────────
// Salud por canal. Un número que falla mucho probablemente está baneado o con
// la sesión caída: seguir mandándole tráfico quema mensajes y agrava el baneo.
// Reglas (ventana 24h):
//   - quarantined: sus últimos 3 envíos resueltos fallaron, o ≥5 intentos con
//     ≥50% de fallo → no recibe mensajes nuevos y su backlog se reasigna.
//   - degraded:    ≥4 intentos con ≥25% de fallo → solo se usa si no hay sanos.
//   - healthy:     el resto.
// ──────────────────────────────────────────────────────────────────

export type ChannelHealthStatus = "healthy" | "degraded" | "quarantined";

const RESOLVED_OK = ["sent", "delivered", "read"];

export async function getChannelHealth(
  workspaceId: string,
  instanceName: string
): Promise<{ status: ChannelHealthStatus; ok24h: number; failed24h: number }> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const base = { workspaceId, instanceName };
  const [ok24h, failed24h, last3] = await Promise.all([
    prisma.leadMessage.count({
      where: { ...base, status: { in: RESOLVED_OK }, sentAt: { gte: dayAgo } }
    }),
    // LeadMessage no guarda cuándo falló; createdAt es la mejor aproximación
    // (mismo criterio que /leads/channels-health).
    prisma.leadMessage.count({
      where: { ...base, status: "failed", createdAt: { gte: dayAgo } }
    }),
    prisma.leadMessage.findMany({
      where: { ...base, status: { in: [...RESOLVED_OK, "failed"] } },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { status: true }
    })
  ]);
  const attempts = ok24h + failed24h;
  const failRate = attempts > 0 ? failed24h / attempts : 0;
  const last3AllFailed = last3.length >= 3 && last3.every((m) => m.status === "failed");
  let status: ChannelHealthStatus = "healthy";
  if (last3AllFailed || (attempts >= 5 && failRate >= 0.5)) status = "quarantined";
  else if (attempts >= 4 && failRate >= 0.25) status = "degraded";
  return { status, ok24h, failed24h };
}

/** Salud de todos los canales dados (o de los del workspace). */
export async function getChannelsHealthMap(
  workspaceId: string,
  channels?: LeadChannel[]
): Promise<Map<string, ChannelHealthStatus>> {
  const list = channels ?? (await getLeadChannels(workspaceId));
  const map = new Map<string, ChannelHealthStatus>();
  for (const c of list) {
    const h = await getChannelHealth(workspaceId, c.name);
    map.set(c.name, h.status);
  }
  return map;
}

/**
 * Elige el canal para el próximo mensaje a encolar. Devuelve el nombre de
 * sesión/instancia, o null para usar el comportamiento por defecto (sin
 * multi-número configurado). Evita números en cuarentena y prefiere sanos.
 */
export async function pickEnqueueChannel(workspaceId: string): Promise<string | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const leads: any = (ws?.settings as any)?.leads ?? {};
  const channels: LeadChannel[] = (Array.isArray(leads.channels) ? leads.channels : []).filter(
    (c: any) => c && typeof c.name === "string" && c.name.trim() && c.active !== false
  );
  if (channels.length === 0) return null; // sin multi-número → número principal (instanceName null)

  // El número PRINCIPAL (instanceName = null) también reparte, junto a los
  // números extra. Así, al añadir un número, el volumen se DISTRIBUYE entre
  // todos (principal + extra) y cada uno conserva su propio cupo anti-baneo.
  const PRINCIPAL = "__principal__";
  type Slot = { key: string; instanceName: string | null; dailyLimit: number };
  const slots: Slot[] = [
    { key: PRINCIPAL, instanceName: null, dailyLimit: Number(leads.dailyLimit) || 80 },
    // Cada número extra usa su tope EFECTIVO de calentamiento (rampa por teléfono).
    ...channels.map((c) => ({ key: c.name, instanceName: c.name, dailyLimit: channelWarmupCap(c, leads).cap }))
  ];

  // Salud: descartamos canales en cuarentena (el principal se asume disponible).
  const health = await getChannelsHealthMap(workspaceId, channels);
  const notQuarantined = slots.filter((s) => s.key === PRINCIPAL || health.get(s.key) !== "quarantined");
  const candidates = notQuarantined.length > 0 ? notQuarantined : slots;
  const healthy = candidates.filter((s) => s.key === PRINCIPAL || health.get(s.key) === "healthy");
  const roster = healthy.length > 0 ? healthy : candidates;
  if (roster.length === 1) return roster[0].instanceName;

  // Uso de hoy por número (enviados + programados pendientes).
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const used = new Map<string, number>();
  for (const sl of roster) {
    const n = await prisma.leadMessage.count({
      where: {
        workspaceId,
        instanceName: sl.instanceName, // null = principal
        OR: [
          { sentAt: { gte: dayStart, lt: dayEnd } },
          { scheduledAt: { gte: dayStart, lt: dayEnd }, status: { in: ["queued", "sending"] } }
        ]
      }
    });
    used.set(sl.key, n);
  }

  // Preferimos los que están bajo su tope; si todos llenos, repartimos al menos
  // cargado (el tope diario global, ya escalado por nº de números, aplica aparte).
  const underCap = roster.filter((sl) => (used.get(sl.key) ?? 0) < sl.dailyLimit);
  const pool = underCap.length > 0 ? underCap : roster;
  pool.sort((a, b) => (used.get(a.key) ?? 0) - (used.get(b.key) ?? 0));
  return pool[0].instanceName;
}

/**
 * Rotación al ENVIAR: si el canal asignado a un mensaje está en cuarentena,
 * devuelve un canal alternativo (sano si lo hay) o null si no hay mejor
 * opción. Así un número quemado no bloquea su backlog: sale por otro.
 */
export async function reassignIfQuarantined(
  workspaceId: string,
  currentInstanceName: string | null
): Promise<string | null> {
  if (!currentInstanceName) return null;
  const channels = (await getLeadChannels(workspaceId)).filter((c) => c.active !== false);
  if (channels.length < 2) return null;
  const current = await getChannelHealth(workspaceId, currentInstanceName);
  if (current.status !== "quarantined") return null;
  const alternative = await pickEnqueueChannel(workspaceId);
  return alternative && alternative !== currentInstanceName ? alternative : null;
}
