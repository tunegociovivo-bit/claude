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
  const channels = (await getLeadChannels(workspaceId)).filter((c) => c.active !== false);
  if (channels.length === 0) return null;
  if (channels.length === 1) return channels[0].name;

  // Salud: fuera los que están en cuarentena (si TODOS lo están seguimos con
  // todos para no parar el sistema); entre el resto, los sanos van primero.
  const health = await getChannelsHealthMap(workspaceId, channels);
  const notQuarantined = channels.filter((c) => health.get(c.name) !== "quarantined");
  const candidates = notQuarantined.length > 0 ? notQuarantined : channels;
  const healthy = candidates.filter((c) => health.get(c.name) === "healthy");
  const roster = healthy.length > 0 ? healthy : candidates;
  if (roster.length === 1) return roster[0].name;

  // Uso de hoy por canal (enviados + programados pendientes).
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const used = new Map<string, number>();
  for (const c of roster) {
    const n = await prisma.leadMessage.count({
      where: {
        workspaceId,
        instanceName: c.name,
        OR: [
          { sentAt: { gte: dayStart, lt: dayEnd } },
          { scheduledAt: { gte: dayStart, lt: dayEnd }, status: { in: ["queued", "sending"] } }
        ]
      }
    });
    used.set(c.name, n);
  }

  // Preferimos los que están bajo su tope; si todos llenos, igualmente repartimos
  // al menos cargado (el tope diario global de Ajustes sigue aplicando aparte).
  const underCap = roster.filter((c) => (used.get(c.name) ?? 0) < (c.dailyLimit ?? DEFAULT_CHANNEL_DAILY_LIMIT));
  const pool = underCap.length > 0 ? underCap : roster;
  pool.sort((a, b) => (used.get(a.name) ?? 0) - (used.get(b.name) ?? 0));
  return pool[0].name;
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
