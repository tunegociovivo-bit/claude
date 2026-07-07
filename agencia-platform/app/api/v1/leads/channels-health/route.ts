/**
 * GET /api/v1/leads/channels-health
 *
 * Salud de cada número de WhatsApp (sesión WAHA / instancia Evolution) para el
 * reparto multi-número: enviados/entregados/leídos/fallidos hoy y en 7 días.
 * Permite detectar un número que se está quemando (muchos fallos) o caído.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { getLeadChannels, getChannelHealth } from "@/lib/leads/channels";

const SENT_OK = ["sent", "delivered", "read"];

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const channels = await getLeadChannels(api.workspaceId);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const replyGuard = (ws?.settings as any)?.leads?.replyRateGuardEnabled === true;

  const now = Date.now();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  async function statsFor(instanceName: string | null) {
    const base = { workspaceId: api.workspaceId, instanceName };
    const [sentToday, sent7, delivered7, read7, failed7, replies7] = await Promise.all([
      prisma.leadMessage.count({ where: { ...base, status: { in: SENT_OK }, sentAt: { gte: dayStart } } }),
      prisma.leadMessage.count({ where: { ...base, status: { in: SENT_OK }, sentAt: { gte: weekAgo } } }),
      prisma.leadMessage.count({ where: { ...base, status: { in: ["delivered", "read"] }, sentAt: { gte: weekAgo } } }),
      prisma.leadMessage.count({ where: { ...base, status: "read", sentAt: { gte: weekAgo } } }),
      prisma.leadMessage.count({ where: { ...base, status: "failed", createdAt: { gte: weekAgo } } }),
      // Respuestas recibidas por ESTE número en 7 días (para la tasa de respuesta).
      prisma.leadInboxMessage.count({ where: { workspaceId: api.workspaceId, instanceName, direction: "in", receivedAt: { gte: weekAgo } } })
    ]);
    return { sentToday, sent7, delivered7, read7, failed7, replies7 };
  }

  const items = [];
  for (const c of channels) {
    // Estado de salud usado por el reparto/rotación (healthy|degraded|quarantined).
    const health = await getChannelHealth(api.workspaceId, c.name, { replyGuard });
    items.push({
      name: c.name,
      label: c.label ?? null,
      active: c.active !== false,
      health: health.status,
      ...(await statsFor(c.name))
    });
  }
  // Bucket por defecto (mensajes sin número asignado).
  const def = await statsFor(null);
  if (def.sent7 > 0 || def.failed7 > 0 || channels.length === 0) {
    items.push({ name: null, label: "Por defecto", active: true, ...def });
  }

  return NextResponse.json({ items });
});
