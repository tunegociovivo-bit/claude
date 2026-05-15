/**
 * Analytics: KPIs, distribución, timelines, top provincias.
 * Migra NVL_Analytics.
 */

import { prisma } from "@/lib/db/prisma";

export async function analyticsFunnel(workspaceId: string) {
  const where = { workspaceId };
  const [total, withPhone, withWa, contacted, responded, client, discarded] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...where, phone: { not: null } } }),
    prisma.lead.count({ where: { ...where, hasWhatsapp: true } }),
    prisma.lead.count({ where: { ...where, contactStatus: "contacted" } }),
    prisma.lead.count({ where: { ...where, contactStatus: "responded" } }),
    prisma.lead.count({ where: { ...where, contactStatus: "client" } }),
    prisma.lead.count({ where: { ...where, contactStatus: "discarded" } })
  ]);
  return { total, withPhone, withWa, contacted, responded, client, discarded };
}

export async function scoreDistribution(workspaceId: string) {
  const buckets: Record<string, number> = {
    "80-100": 0,
    "60-79": 0,
    "40-59": 0,
    "20-39": 0,
    "0-19": 0
  };
  const rows = await prisma.lead.findMany({
    where: { workspaceId, score: { not: null } },
    select: { score: true }
  });
  for (const r of rows) {
    const s = r.score ?? 0;
    if (s >= 80) buckets["80-100"]++;
    else if (s >= 60) buckets["60-79"]++;
    else if (s >= 40) buckets["40-59"]++;
    else if (s >= 20) buckets["20-39"]++;
    else buckets["0-19"]++;
  }
  return buckets;
}

export async function urgencyBreakdown(workspaceId: string) {
  const rows = await prisma.lead.groupBy({
    by: ["urgency"],
    where: { workspaceId, urgency: { not: null } },
    _count: true
  });
  const out: Record<string, number> = { critica: 0, alta: 0, media: 0, baja: 0, descartar: 0 };
  for (const r of rows) {
    const k = r.urgency ?? "";
    if (k in out) out[k] = r._count;
  }
  return out;
}

export async function messagesLast30Days(workspaceId: string) {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const rows = await prisma.leadMessage.findMany({
    where: { workspaceId, sentAt: { not: null, gte: since } },
    select: { sentAt: true }
  });
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (!r.sentAt) continue;
    const k = r.sentAt.toISOString().slice(0, 10);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  // Devuelve array ordenado de los últimos 30 días
  const out: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    out.push({ date: k, count: byDay.get(k) ?? 0 });
  }
  return out;
}

export async function responsesLast30Days(workspaceId: string) {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const rows = await prisma.leadInboxMessage.findMany({
    where: { workspaceId, direction: "in", receivedAt: { gte: since } },
    select: { receivedAt: true }
  });
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const k = r.receivedAt.toISOString().slice(0, 10);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const out: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    out.push({ date: k, count: byDay.get(k) ?? 0 });
  }
  return out;
}

export async function topProvinces(workspaceId: string, limit = 10) {
  const rows = await prisma.lead.groupBy({
    by: ["province"],
    where: { workspaceId, province: { not: null } },
    _count: true,
    orderBy: { _count: { province: "desc" } },
    take: limit
  });
  return rows.map((r) => ({ province: r.province ?? "—", count: r._count }));
}
