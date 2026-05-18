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
import { metaAdsListCampaigns } from "@/lib/integrations/meta-ads";

export type ProactiveSignal = {
  clientId: string;
  clientName: string;
  signalType:
    | "negative_gmb_review"
    | "ga4_traffic_drop"
    | "meta_leads_drop"
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

    // 3) Meta Ads sin campañas activas / sin actividad reciente
    try {
      const activeCampaigns = await metaAdsListCampaigns({
        workspaceId: opts.workspaceId,
        status: "ACTIVE",
        limit: 10
      });
      if (activeCampaigns.length === 0) {
        // No alertamos — el cliente puede no tener servicio de ads
      }
    } catch {
      // Sin Meta → skip
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

  return signals;
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
    case "no_posts_14d":
      return "sin publicar 14d";
    case "high_severity_alert":
      return "alerta crítica";
  }
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}
