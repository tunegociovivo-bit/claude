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
import { getLeadChannels } from "@/lib/leads/channels";

const SENT_OK = ["sent", "delivered", "read"];

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const channels = await getLeadChannels(api.workspaceId);

  const now = Date.now();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  async function statsFor(instanceName: string | null) {
    const base = { workspaceId: api.workspaceId, instanceName };
    const [sentToday, sent7, delivered7, read7, failed7] = await Promise.all([
      prisma.leadMessage.count({ where: { ...base, status: { in: SENT_OK }, sentAt: { gte: dayStart } } }),
      prisma.leadMessage.count({ where: { ...base, status: { in: SENT_OK }, sentAt: { gte: weekAgo } } }),
      prisma.leadMessage.count({ where: { ...base, status: { in: ["delivered", "read"] }, sentAt: { gte: weekAgo } } }),
      prisma.leadMessage.count({ where: { ...base, status: "read", sentAt: { gte: weekAgo } } }),
      prisma.leadMessage.count({ where: { ...base, status: "failed", createdAt: { gte: weekAgo } } })
    ]);
    return { sentToday, sent7, delivered7, read7, failed7 };
  }

  const items = [];
  for (const c of channels) {
    items.push({ name: c.name, label: c.label ?? null, active: c.active !== false, ...(await statsFor(c.name)) });
  }
  // Bucket por defecto (mensajes sin número asignado).
  const def = await statsFor(null);
  if (def.sent7 > 0 || def.failed7 > 0 || channels.length === 0) {
    items.push({ name: null, label: "Por defecto", active: true, ...def });
  }

  return NextResponse.json({ items });
});
