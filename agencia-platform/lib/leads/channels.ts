/**
 * Multi-número de WhatsApp con reparto. Un "canal" es un número/sesión (WAHA)
 * o instancia (Evolution) en el mismo servidor. Se configuran en
 * settings.leads.channels = [{ name, label?, dailyLimit?, active? }].
 *
 * El reparto se hace al ENCOLAR: a cada mensaje se le asigna el canal con menos
 * uso hoy que esté bajo su tope diario (load-balancing + anti-baneo). El bucle
 * de envío ya respeta `LeadMessage.instanceName`, así que no se toca.
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

/**
 * Elige el canal para el próximo mensaje a encolar. Devuelve el nombre de
 * sesión/instancia, o null para usar el comportamiento por defecto (sin
 * multi-número configurado).
 */
export async function pickEnqueueChannel(workspaceId: string): Promise<string | null> {
  const channels = (await getLeadChannels(workspaceId)).filter((c) => c.active !== false);
  if (channels.length === 0) return null;
  if (channels.length === 1) return channels[0].name;

  // Uso de hoy por canal (enviados + programados pendientes).
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const used = new Map<string, number>();
  for (const c of channels) {
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
  const underCap = channels.filter((c) => (used.get(c.name) ?? 0) < (c.dailyLimit ?? DEFAULT_CHANNEL_DAILY_LIMIT));
  const pool = underCap.length > 0 ? underCap : channels;
  pool.sort((a, b) => (used.get(a.name) ?? 0) - (used.get(b.name) ?? 0));
  return pool[0].name;
}
