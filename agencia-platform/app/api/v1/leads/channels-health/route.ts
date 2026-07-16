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
  const leadsS: any = (ws?.settings as any)?.leads ?? {};
  const replyGuard = leadsS.replyRateGuardEnabled === true;
  const proxyStatus: Record<string, any> = leadsS.proxyStatus ?? {};
  const hasGlobalProxy = !!(leadsS.wahaProxy && String(leadsS.wahaProxy).trim());

  // Puntuación de riesgo de baneo por número (0-100, mayor = peor). Explicable:
  // suma señales objetivas (salud, fallos, sin respuestas, número nuevo, sin proxy).
  function riskScore(opts: {
    status: string;
    sent7: number;
    failed7: number;
    replies7: number;
    ageDays: number | null;
    hasProxyOk: boolean;
  }): { risk: number; label: string } {
    const attempts = opts.sent7 + opts.failed7;
    const failRate = attempts > 0 ? opts.failed7 / attempts : 0;
    let risk = 0;
    if (opts.status === "quarantined") risk += 60;
    else if (opts.status === "degraded") risk += 30;
    risk += Math.round(failRate * 30);
    if (opts.sent7 >= 30 && opts.replies7 === 0) risk += 25; // manda y nadie responde
    if (opts.ageDays !== null && opts.ageDays < 7) risk += 15; // muy nuevo
    if (!opts.hasProxyOk) risk += 15; // sin IP de proxy verificada (sale por datacenter)
    risk = Math.min(100, risk);
    return { risk, label: risk >= 55 ? "alto" : risk >= 25 ? "medio" : "bajo" };
  }

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
  for (const c of channels as any[]) {
    // Estado de salud usado por el reparto/rotación (healthy|degraded|quarantined).
    const health = await getChannelHealth(api.workspaceId, c.name, { replyGuard });
    const stats = await statsFor(c.name);
    // Edad del número (desde su calentamiento/alta).
    const sinceStr = c.warmupSince || c.addedAt;
    const sinceT = sinceStr ? Date.parse(sinceStr) : NaN;
    const ageDays = Number.isNaN(sinceT) ? null : Math.floor((Date.now() - sinceT) / 86_400_000);
    // IP de salida del proxy de este número (o global).
    const px = proxyStatus[c.name] ?? proxyStatus["__global__"];
    const exitIp = px?.ok ? px.exitIp ?? null : null;
    const hasProxyOk = !!exitIp;
    const { risk, label: riskLabel } = riskScore({
      status: health.status,
      sent7: stats.sent7,
      failed7: stats.failed7,
      replies7: stats.replies7,
      ageDays,
      hasProxyOk
    });
    items.push({
      name: c.name,
      label: c.label ?? null,
      active: c.active !== false,
      health: health.status,
      ageDays,
      exitIp,
      hasProxy: !!(c.proxy || hasGlobalProxy),
      risk,
      riskLabel,
      ...stats
    });
  }
  // Bucket por defecto (mensajes sin número asignado).
  const def = await statsFor(null);
  if (def.sent7 > 0 || def.failed7 > 0 || channels.length === 0) {
    items.push({ name: null, label: "Por defecto", active: true, ...def });
  }

  return NextResponse.json({ items });
});
