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

export type ConversionRow = {
  key: string;
  total: number;
  contacted: number; // contactados o más avanzados (contacted+responded+client)
  responded: number; // respondieron o más (responded+client)
  client: number;
  responseRate: number; // % respondidos / contactados
  clientRate: number; // % clientes / contactados
};

/** Convierte un acumulado por estado en métricas de embudo acumulativas. */
function finalizeConversion(
  agg: Map<string, { total: number; contacted: number; responded: number; client: number }>,
  limit: number
): ConversionRow[] {
  const out: ConversionRow[] = [];
  for (const [key, a] of agg) {
    const contactedPlus = a.contacted + a.responded + a.client;
    const respondedPlus = a.responded + a.client;
    out.push({
      key,
      total: a.total,
      contacted: contactedPlus,
      responded: respondedPlus,
      client: a.client,
      responseRate: contactedPlus ? Math.round((respondedPlus / contactedPlus) * 1000) / 10 : 0,
      clientRate: contactedPlus ? Math.round((a.client / contactedPlus) * 1000) / 10 : 0
    });
  }
  out.sort((x, y) => y.total - x.total);
  return out.slice(0, limit);
}

function addStatus(
  agg: Map<string, { total: number; contacted: number; responded: number; client: number }>,
  key: string,
  status: string,
  count: number
) {
  const a = agg.get(key) ?? { total: 0, contacted: 0, responded: 0, client: 0 };
  a.total += count;
  if (status === "contacted") a.contacted += count;
  else if (status === "responded") a.responded += count;
  else if (status === "client") a.client += count;
  agg.set(key, a);
}

/** Conversión por NICHO (keyword de la búsqueda de la que salió el lead). */
export async function conversionByNiche(workspaceId: string, limit = 20): Promise<ConversionRow[]> {
  const grouped = await prisma.lead.groupBy({
    by: ["searchId", "contactStatus"],
    where: { workspaceId },
    _count: true
  });
  const searchIds = Array.from(
    new Set(grouped.map((g) => g.searchId).filter((x): x is string => !!x))
  );
  const searches = searchIds.length
    ? await prisma.leadSearch.findMany({ where: { id: { in: searchIds } }, select: { id: true, keyword: true } })
    : [];
  const kwById = new Map(searches.map((s) => [s.id, s.keyword]));
  const agg = new Map<string, { total: number; contacted: number; responded: number; client: number }>();
  for (const g of grouped) {
    const kw = (g.searchId ? kwById.get(g.searchId) : null) ?? "Sin nicho";
    addStatus(agg, kw, g.contactStatus, g._count);
  }
  return finalizeConversion(agg, limit);
}

/** Conversión por PROVINCIA. */
export async function conversionByProvince(workspaceId: string, limit = 20): Promise<ConversionRow[]> {
  const grouped = await prisma.lead.groupBy({
    by: ["province", "contactStatus"],
    where: { workspaceId },
    _count: true
  });
  const agg = new Map<string, { total: number; contacted: number; responded: number; client: number }>();
  for (const g of grouped) {
    addStatus(agg, g.province ?? "—", g.contactStatus, g._count);
  }
  return finalizeConversion(agg, limit);
}

const TIER_LABEL: Record<string, string> = {
  premium: "💎 Premium",
  alto: "Alto",
  medio: "Medio",
  bajo: "Bajo"
};

/** Conversión por TICKET-TIER (valor estimado del cliente). */
export async function conversionByTicketTier(workspaceId: string): Promise<ConversionRow[]> {
  const grouped = await prisma.lead.groupBy({
    by: ["ticketTier", "contactStatus"],
    where: { workspaceId },
    _count: true
  });
  const agg = new Map<string, { total: number; contacted: number; responded: number; client: number }>();
  for (const g of grouped) {
    addStatus(agg, TIER_LABEL[g.ticketTier ?? ""] ?? "Sin clasificar", g.contactStatus, g._count);
  }
  // Orden fijo premium→bajo en vez de por volumen.
  const order = ["💎 Premium", "Alto", "Medio", "Bajo", "Sin clasificar"];
  return finalizeConversion(agg, 10).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** Conversión por FUENTE de captación (places, borme, meta_ads, directorios…). */
export async function conversionBySource(workspaceId: string): Promise<ConversionRow[]> {
  const grouped = await prisma.lead.groupBy({
    by: ["searchId", "contactStatus"],
    where: { workspaceId },
    _count: true
  });
  const searchIds = Array.from(new Set(grouped.map((g) => g.searchId).filter((x): x is string => !!x)));
  const searches = searchIds.length
    ? await prisma.leadSearch.findMany({ where: { id: { in: searchIds } }, select: { id: true, source: true } })
    : [];
  const SOURCE_LABEL: Record<string, string> = {
    places: "Google Places",
    borme: "BORME",
    meta_ads: "Meta Ads",
    doctoralia: "Doctoralia",
    idealista: "Idealista",
    fotocasa: "Fotocasa"
  };
  const srcById = new Map(searches.map((s) => [s.id, SOURCE_LABEL[(s as any).source ?? "places"] ?? (s as any).source ?? "—"]));
  const agg = new Map<string, { total: number; contacted: number; responded: number; client: number }>();
  for (const g of grouped) {
    const src = (g.searchId ? srcById.get(g.searchId) : null) ?? "Google Places";
    addStatus(agg, src, g.contactStatus, g._count);
  }
  return finalizeConversion(agg, 10);
}

/** Métricas del embudo de DIRECTIVOS (secuencias multicanal). */
export async function execOutreachStats(workspaceId: string): Promise<{
  total: number;
  active: number;
  done: number;
  stopped: number;
  emailsSent: number;
}> {
  const [byStatus, rows] = await Promise.all([
    prisma.leadExecOutreach.groupBy({ by: ["status"], where: { workspaceId }, _count: true }),
    prisma.leadExecOutreach.findMany({ where: { workspaceId }, select: { log: true } })
  ]);
  const count = (s: string) => byStatus.find((x) => x.status === s)?._count ?? 0;
  let emailsSent = 0;
  for (const r of rows) {
    if (Array.isArray(r.log)) emailsSent += (r.log as any[]).filter((e) => e?.channel === "email").length;
  }
  return {
    total: byStatus.reduce((s, x) => s + x._count, 0),
    active: count("active"),
    done: count("done"),
    stopped: count("stopped"),
    emailsSent
  };
}
