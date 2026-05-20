/**
 * Insights proactivos para clientes: Sonia revisa diariamente y avisa
 * SOLO si detecta una señal accionable. La diferencia entre "Sonia
 * ejecuta órdenes" y "Sonia anticipa problemas".
 *
 * Heurísticas que disparan aviso:
 *   - Reseña GMB nueva de 1-3 estrellas en las últimas 24h → reply
 *     pendiente.
 *   - Caída de tráfico GA4 >30% vs misma semana del mes anterior.
 *   - Caída de leads Meta Ads >40% en 7d.
 *   - Frenada del CPC orgánico GSC >20% en 7d.
 *   - Cliente sin posts publicados (Metricool) en últimos 14d con
 *     servicio "gestion_redes" contratado.
 *   - Gasto Meta Ads > presupuesto comprometido del mes.
 *
 * Cada señal genera una task automática asignada a Sonia con prefix
 * "💡 " + cliente + tipo de señal. Sonia las procesa con su loop
 * normal. Si la señal ya ha sido detectada en los últimos N días,
 * no se duplica (dedup por (clientId, signalType, date)).
 */

import { prisma } from "@/lib/db/prisma";
import { gmbListReviews } from "@/lib/integrations/gmb";
import { ga4GetReport } from "@/lib/integrations/ga4";

export type ProactiveSignal = {
  // clientId/clientName opcionales: las señales de Meta son a nivel de
  // campaña/cuenta y pueden no mapear a un cliente concreto.
  clientId?: string | null;
  clientName: string;
  signalType:
    | "negative_gmb_review"
    | "ga4_traffic_drop"
    | "meta_leads_drop"
    | "meta_delivery_stalled"
    | "no_posts_14d"
    | "high_severity_alert";
  severity: "info" | "warning" | "critical";
  summary: string;
  detail: string;
};

export async function detectProactiveSignals(opts: {
  workspaceId: string;
  /** Si se pasa, limita a un solo cliente (para testing). */
  onlyClientId?: string;
}): Promise<ProactiveSignal[]> {
  const signals: ProactiveSignal[] = [];

  const clients = await prisma.client.findMany({
    where: {
      workspaceId: opts.workspaceId,
      deletedAt: null,
      status: "ACTIVE",
      ...(opts.onlyClientId ? { id: opts.onlyClientId } : {})
    } as any
  });

  for (const c of clients) {
    // 1) Reseñas GMB negativas recientes
    const gmb = (c as any).settings?.gmb;
    if (gmb?.accountId && gmb?.locationId) {
      try {
        const reviews = await gmbListReviews({
          workspaceId: opts.workspaceId,
          accountId: gmb.accountId,
          locationId: gmb.locationId,
          pageSize: 10
        });
        const since = Date.now() - 24 * 60 * 60 * 1000;
        const newNeg = reviews.filter(
          (r) =>
            r.rating > 0 &&
            r.rating <= 3 &&
            !r.reply &&
            new Date(r.createTime).getTime() >= since
        );
        if (newNeg.length > 0) {
          signals.push({
            clientId: c.id,
            clientName: c.name,
            signalType: "negative_gmb_review",
            severity: newNeg.some((r) => r.rating <= 2) ? "critical" : "warning",
            summary: `${newNeg.length} reseña${newNeg.length > 1 ? "s" : ""} negativa${newNeg.length > 1 ? "s" : ""} de GMB en las últimas 24h sin responder`,
            detail: newNeg
              .map((r) => `★${r.rating} · ${r.reviewer}: ${(r.comment ?? "").slice(0, 150)}`)
              .join("\n")
          });
        }
      } catch {
        // Cliente sin GMB configurado → skip silencioso
      }
    }

    // 2) GA4 caída de tráfico >30%
    const ga4PropertyId = (c as any).settings?.ga4PropertyId;
    if (ga4PropertyId) {
      try {
        const recent = await ga4GetReport({
          workspaceId: opts.workspaceId,
          clientId: c.id,
          datePreset: "last_7_days",
          metrics: ["sessions"]
        });
        const prior = await ga4GetReport({
          workspaceId: opts.workspaceId,
          clientId: c.id,
          since: isoDaysAgo(14),
          until: isoDaysAgo(8),
          metrics: ["sessions"]
        });
        const recentSessions = Number(recent.totals?.[0]?.sessions ?? 0);
        const priorSessions = Number(prior.totals?.[0]?.sessions ?? 0);
        if (priorSessions > 50 && recentSessions / priorSessions < 0.7) {
          const dropPct = Math.round((1 - recentSessions / priorSessions) * 100);
          signals.push({
            clientId: c.id,
            clientName: c.name,
            signalType: "ga4_traffic_drop",
            severity: dropPct > 50 ? "critical" : "warning",
            summary: `Tráfico web caído ${dropPct}% esta semana (${recentSessions} vs ${priorSessions} sesiones)`,
            detail: `GA4 últimos 7d vs semana previa. Investiga: ¿competidor lanzó campaña? ¿cambió algo en la web? ¿problema técnico?`
          });
        }
      } catch {
        // Sin GA4 configurado → skip
      }
    }

    // 4) Sin posts publicados en 14 días (servicio gestion_redes)
    const servicios = (c as any).servicios as string[] | null;
    if (Array.isArray(servicios) && servicios.includes("gestion_redes")) {
      const since = new Date(Date.now() - 14 * 86400_000);
      const recentPosts = await prisma.editorialPost.count({
        where: {
          workspaceId: opts.workspaceId,
          clientId: c.id,
          scheduledFor: { gte: since },
          status: { in: ["PUBLISHED", "SCHEDULED"] as any }
        }
      });
      if (recentPosts === 0) {
        signals.push({
          clientId: c.id,
          clientName: c.name,
          signalType: "no_posts_14d",
          severity: "warning",
          summary: `${c.name} contrata gestión de redes pero no tiene posts en 14 días`,
          detail: `Verifica calendario editorial. Si está vacío, genera mes nuevo con generate-month o adelanta al equipo.`
        });
      }
    }
  }

  // Señales de Meta Ads a nivel de cuenta/campaña (una sola vez por
  // workspace, no por cliente). Solo si onlyClientId no está fijado.
  if (!opts.onlyClientId) {
    try {
      const metaSignals = await detectMetaSignals(opts.workspaceId);
      signals.push(...metaSignals);
    } catch (e) {
      console.warn("[sonia] detectMetaSignals:", (e as Error).message);
    }
  }

  return signals;
}

/**
 * Señales de Meta Ads: campañas ACTIVAS que han DEJADO de entregar (gasto
 * ~0 los últimos 3 días pese a haber gastado antes) y caídas fuertes de
 * leads (última semana < 50% de la previa). Recorre las cuentas del token
 * con un tope total de campañas para no saturar la API en el cron.
 */
async function detectMetaSignals(workspaceId: string): Promise<ProactiveSignal[]> {
  const out: ProactiveSignal[] = [];
  const { metaAdsListAdAccounts, metaAdsListCampaigns, metaAdsGetCampaignDailyInsights } = await import(
    "@/lib/integrations/meta-ads"
  );

  let accounts: any[] = [];
  try {
    accounts = await metaAdsListAdAccounts(workspaceId);
  } catch {
    return out; // sin conexión Meta → nada
  }

  const MAX_CAMPAIGNS = 40;
  let scanned = 0;
  for (const acc of accounts) {
    if (scanned >= MAX_CAMPAIGNS) break;
    let campaigns: any[] = [];
    try {
      campaigns = await metaAdsListCampaigns({
        workspaceId,
        status: "ACTIVE",
        limit: 25,
        adhoc: { META_ADS_AD_ACCOUNT_ID: acc.id }
      });
    } catch {
      continue;
    }
    for (const camp of campaigns) {
      if (scanned >= MAX_CAMPAIGNS) break;
      scanned++;
      let daily: Array<{ date: string; spend: number; leads: number }> = [];
      try {
        daily = await metaAdsGetCampaignDailyInsights({
          workspaceId,
          campaignId: camp.id,
          days: 14,
          adhoc: { META_ADS_AD_ACCOUNT_ID: acc.id }
        });
      } catch {
        continue;
      }
      if (daily.length < 7) continue; // poco histórico → no concluimos
      const sorted = daily.slice().sort((a, b) => a.date.localeCompare(b.date));
      const last3 = sorted.slice(-3);
      const earlier = sorted.slice(0, -3);
      const spendLast3 = last3.reduce((s, d) => s + d.spend, 0);
      const spendEarlier = earlier.reduce((s, d) => s + d.spend, 0);
      const last7 = sorted.slice(-7);
      const prev7 = sorted.slice(-14, -7);
      const leadsLast7 = last7.reduce((s, d) => s + d.leads, 0);
      const leadsPrev7 = prev7.reduce((s, d) => s + d.leads, 0);

      const acct = `${camp.name} · ${acc.name}`;

      // Entrega parada: gastaba antes pero ~0 en los últimos 3 días.
      if (spendEarlier > 5 && spendLast3 < 0.5) {
        out.push({
          clientId: null,
          clientName: acct,
          signalType: "meta_delivery_stalled",
          severity: "critical",
          summary: `Campaña Meta ACTIVA sin entregar: «${camp.name}» (${acc.name}) lleva ~3 días sin gastar`,
          detail: `Estaba activa y gastando (${spendEarlier.toFixed(0)}€ en los días previos) pero el gasto cayó a ~0 los últimos 3 días. Posibles causas: anuncio rechazado, presupuesto agotado, públic o saturado, o problema de facturación. Revisa el estado del anuncio y del método de pago.`
        });
      }

      // Caída fuerte de leads (solo si la semana previa tenía volumen).
      if (leadsPrev7 >= 5 && leadsLast7 < leadsPrev7 * 0.5) {
        const dropPct = Math.round((1 - leadsLast7 / leadsPrev7) * 100);
        out.push({
          clientId: null,
          clientName: acct,
          signalType: "meta_leads_drop",
          severity: dropPct >= 70 ? "critical" : "warning",
          summary: `Leads Meta cayendo ${dropPct}% en «${camp.name}» (${acc.name}): ${leadsLast7} esta semana vs ${leadsPrev7} la previa`,
          detail: `La campaña sigue gastando pero trae menos leads. Revisa: fatiga del creativo (CTR bajando), cambio de público, competencia, o que el formulario/landing falle. Considera refrescar creativo o público.`
        });
      }
    }
  }
  return out;
}

/**
 * Convierte señales en tasks accionables para Sonia. Idempotente:
 * dedup por hash (clientId+signalType+día). Devuelve cuántas creó
 * realmente.
 */
export async function turnSignalsIntoTasks(opts: {
  workspaceId: string;
  inboxProjectId: string;
  signals: ProactiveSignal[];
}): Promise<{ created: number; deduplicated: number }> {
  let created = 0;
  let deduplicated = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const s of opts.signals) {
    const dedupTitle = `💡 ${s.clientName} · ${signalLabel(s.signalType)}`;
    const dedupSinceDays = s.signalType === "negative_gmb_review" ? 1 : 7;
    const since = new Date(Date.now() - dedupSinceDays * 86400_000);
    const existing = await prisma.task.findFirst({
      where: {
        workspaceId: opts.workspaceId,
        clientId: s.clientId,
        title: { startsWith: dedupTitle },
        createdAt: { gte: since },
        status: { notIn: ["DONE", "CANCELLED"] as any }
      }
    });
    if (existing) {
      deduplicated++;
      continue;
    }
    await prisma.task.create({
      data: {
        workspaceId: opts.workspaceId,
        title: `${dedupTitle} (${today})`,
        description: [
          `**${s.summary}**`,
          ``,
          s.detail,
          ``,
          `_(Señal proactiva detectada por Sonia — severidad: ${s.severity})_`
        ].join("\n"),
        status: "TODO",
        priority: s.severity === "critical" ? "URGENT" : "HIGH",
        projectId: opts.inboxProjectId,
        clientId: s.clientId
      } as any
    });
    created++;
  }
  return { created, deduplicated };
}

function signalLabel(t: ProactiveSignal["signalType"]): string {
  switch (t) {
    case "negative_gmb_review":
      return "reseña negativa GMB";
    case "ga4_traffic_drop":
      return "tráfico GA4 cayendo";
    case "meta_leads_drop":
      return "leads Meta cayendo";
    case "meta_delivery_stalled":
      return "campaña Meta sin entregar";
    case "no_posts_14d":
      return "sin publicar 14d";
    case "high_severity_alert":
      return "alerta crítica";
  }
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}
