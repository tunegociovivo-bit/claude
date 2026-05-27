/**
 * Macro: informe mensual de cliente.
 *
 * Combina datos de:
 *   - GA4 (sessions, users, conversions, top sources, top pages)
 *   - Search Console (top queries + top pages orgánicas)
 *   - Meta Ads (campañas + métricas + top performers)
 *   - Google Ads (campañas + métricas)
 *   - Metricool (engagement social por red, opcional)
 *
 * Devuelve un XLSX estilizado con varias hojas + un resumen ejecutivo
 * en markdown que el caller puede pegar como comentario.
 *
 * Si alguna integración no está configurada o falla, se incluye una
 * nota en el resumen ("Google Ads no disponible: X") y se sigue con
 * el resto — el informe es siempre best-effort, nunca todo o nada.
 */

import { ga4GetReport } from "@/lib/integrations/ga4";
import { searchConsoleQuery } from "@/lib/integrations/search-console";
import {
  metaAdsListCampaigns,
  metaAdsTopPerformers
} from "@/lib/integrations/meta-ads";
import {
  gadsListCampaigns,
  gadsCampaignMetrics
} from "@/lib/integrations/google-ads";
import { buildStyledXlsx, type SheetSpec } from "@/lib/files/xlsx-builder";

export type MonthlyReportOpts = {
  workspaceId: string;
  clientId?: string;
  /** "last_30_days" | "last_7_days" | "last_90_days" o {since, until} */
  datePreset?: string;
  since?: string;
  until?: string;
  /** Filtra qué integraciones probar. Default: todas. */
  include?: Array<"ga4" | "searchConsole" | "metaAds" | "googleAds">;
  /** Nombre del cliente — solo para el título del XLSX. */
  clientName?: string;
  /** Color primario del informe (override del azul corporate). */
  primaryColor?: string;
};

export type MonthlyReportResult = {
  filename: string;
  buffer: Buffer;
  /** Resumen markdown listo para pegar como comentario. */
  summary: string;
  /** Diagnóstico — qué fuentes funcionaron y cuáles fallaron. */
  sources: Record<
    "ga4" | "searchConsole" | "metaAds" | "googleAds",
    "ok" | "skipped" | string
  >;
};

export async function generateMonthlyClientReport(
  opts: MonthlyReportOpts
): Promise<MonthlyReportResult> {
  const include = new Set(opts.include ?? ["ga4", "searchConsole", "metaAds", "googleAds"]);
  const sheets: SheetSpec[] = [];
  const sources: MonthlyReportResult["sources"] = {
    ga4: "skipped",
    searchConsole: "skipped",
    metaAds: "skipped",
    googleAds: "skipped"
  };
  const summaryLines: string[] = [];
  const clientLabel = opts.clientName ?? "Cliente";
  const period =
    opts.since && opts.until
      ? `${opts.since} → ${opts.until}`
      : opts.datePreset ?? "últimos 30 días";

  summaryLines.push(`# Informe ${clientLabel} — ${period}`, "");

  // ── GA4 ─────────────────────────────────────────────────────────
  if (include.has("ga4")) {
    try {
      const totals = await ga4GetReport({
        workspaceId: opts.workspaceId,
        clientId: opts.clientId,
        datePreset: opts.datePreset,
        since: opts.since,
        until: opts.until,
        metrics: ["sessions", "totalUsers", "conversions", "engagementRate", "bounceRate"]
      });
      const traffic = await ga4GetReport({
        workspaceId: opts.workspaceId,
        clientId: opts.clientId,
        datePreset: opts.datePreset,
        since: opts.since,
        until: opts.until,
        metrics: ["sessions", "totalUsers", "conversions"],
        dimensions: ["sessionSourceMedium"],
        limit: 20
      });
      const topPages = await ga4GetReport({
        workspaceId: opts.workspaceId,
        clientId: opts.clientId,
        datePreset: opts.datePreset,
        since: opts.since,
        until: opts.until,
        metrics: ["screenPageViews", "totalUsers"],
        dimensions: ["pagePath"],
        limit: 20
      });
      const t = totals.totals?.[0] ?? {};
      summaryLines.push(
        `## Tráfico web (GA4)`,
        `- Sesiones: **${Math.round(Number(t.sessions ?? 0)).toLocaleString("es-ES")}**`,
        `- Usuarios: **${Math.round(Number(t.totalUsers ?? 0)).toLocaleString("es-ES")}**`,
        `- Conversiones: **${Math.round(Number(t.conversions ?? 0)).toLocaleString("es-ES")}**`,
        `- Engagement rate: **${(Number(t.engagementRate ?? 0) * 100).toFixed(1)}%**`,
        ""
      );
      sheets.push({
        name: "GA4 - Totales",
        title: `${clientLabel} — Tráfico web (GA4)`,
        subtitle: `Periodo: ${period}`,
        rows: [t]
      });
      sheets.push({
        name: "GA4 - Fuentes",
        title: "Top fuentes de tráfico",
        rows: traffic.rows,
        columnLabels: {
          sessionSourceMedium: "Fuente / medio",
          sessions: "Sesiones",
          totalUsers: "Usuarios",
          conversions: "Conversiones"
        }
      });
      sheets.push({
        name: "GA4 - Top páginas",
        title: "Páginas más vistas",
        rows: topPages.rows,
        columnLabels: {
          pagePath: "URL",
          screenPageViews: "Páginas vistas",
          totalUsers: "Usuarios"
        }
      });
      sources.ga4 = "ok";
    } catch (e: any) {
      sources.ga4 = e?.message ?? String(e);
      summaryLines.push(`> ⚠️ GA4 no disponible: ${sources.ga4}`, "");
    }
  }

  // ── Search Console ──────────────────────────────────────────────
  if (include.has("searchConsole")) {
    try {
      const queries = await searchConsoleQuery({
        workspaceId: opts.workspaceId,
        clientId: opts.clientId,
        since: opts.since,
        until: opts.until,
        datePreset: opts.datePreset,
        dimensions: ["query"],
        rowLimit: 30
      });
      const pages = await searchConsoleQuery({
        workspaceId: opts.workspaceId,
        clientId: opts.clientId,
        since: opts.since,
        until: opts.until,
        datePreset: opts.datePreset,
        dimensions: ["page"],
        rowLimit: 30
      });
      const totalClicks = queries.rows.reduce(
        (a: number, r: Record<string, any>) => a + Number(r.clicks ?? 0),
        0
      );
      const totalImpr = queries.rows.reduce(
        (a: number, r: Record<string, any>) => a + Number(r.impressions ?? 0),
        0
      );
      summaryLines.push(
        `## SEO orgánico (Search Console)`,
        `- Clicks orgánicos (top 30 queries): **${totalClicks.toLocaleString("es-ES")}**`,
        `- Impresiones: **${totalImpr.toLocaleString("es-ES")}**`,
        queries.rows[0]
          ? `- Top query: **${queries.rows[0].query}** (${queries.rows[0].clicks} clicks)`
          : "",
        ""
      );
      sheets.push({
        name: "SEO - Top queries",
        title: "Top búsquedas orgánicas",
        subtitle: `Periodo: ${queries.startDate} → ${queries.endDate}`,
        rows: queries.rows,
        columnLabels: {
          query: "Búsqueda",
          clicks: "Clicks",
          impressions: "Impresiones",
          ctr: "CTR",
          position: "Posición media"
        }
      });
      sheets.push({
        name: "SEO - Top páginas",
        title: "Páginas con más tráfico orgánico",
        rows: pages.rows,
        columnLabels: {
          page: "URL",
          clicks: "Clicks",
          impressions: "Impresiones",
          ctr: "CTR",
          position: "Posición media"
        }
      });
      sources.searchConsole = "ok";
    } catch (e: any) {
      sources.searchConsole = e?.message ?? String(e);
      summaryLines.push(`> ⚠️ Search Console no disponible: ${sources.searchConsole}`, "");
    }
  }

  // ── Meta Ads ────────────────────────────────────────────────────
  if (include.has("metaAds")) {
    try {
      const datePreset =
        opts.datePreset === "last_7_days"
          ? "last_7d"
          : opts.datePreset === "last_90_days"
            ? "last_90d"
            : "last_30d";
      const campaigns = await metaAdsListCampaigns({
        workspaceId: opts.workspaceId,
        status: "ACTIVE"
      });
      const top = await metaAdsTopPerformers({
        workspaceId: opts.workspaceId,
        datePreset,
        limit: 10
      });
      const flatTop = top.map((t) => ({
        campaignId: t.campaign?.id,
        campaignName: t.campaign?.name,
        spend: Number((t.insights as any)?.spend ?? 0),
        impressions: Number((t.insights as any)?.impressions ?? 0),
        clicks: Number((t.insights as any)?.clicks ?? 0),
        ctr: Number((t.insights as any)?.ctr ?? 0),
        cpc: Number((t.insights as any)?.cpc ?? 0),
        reach: Number((t.insights as any)?.reach ?? 0)
      }));
      summaryLines.push(
        `## Meta Ads`,
        `- Campañas activas: **${campaigns.length}**`,
        flatTop.length
          ? `- Top campaña: **${flatTop[0].campaignName}** — gasto ${flatTop[0].spend.toFixed(2)} €`
          : "- Sin datos de rendimiento en el periodo.",
        ""
      );
      sheets.push({
        name: "Meta - Campañas",
        title: "Campañas activas (Meta)",
        rows: campaigns.slice(0, 50)
      });
      sheets.push({
        name: "Meta - Top performers",
        title: "Mejores campañas Meta",
        subtitle: `Periodo: ${datePreset}`,
        rows: flatTop,
        columnLabels: {
          campaignId: "ID",
          campaignName: "Campaña",
          spend: "Gasto (€)",
          impressions: "Impresiones",
          clicks: "Clicks",
          ctr: "CTR",
          cpc: "CPC (€)",
          reach: "Alcance"
        }
      });
      sources.metaAds = "ok";
    } catch (e: any) {
      sources.metaAds = e?.message ?? String(e);
      summaryLines.push(`> ⚠️ Meta Ads no disponible: ${sources.metaAds}`, "");
    }
  }

  // ── Google Ads ─────────────────────────────────────────────────
  if (include.has("googleAds")) {
    try {
      const campaigns = await gadsListCampaigns({
        workspaceId: opts.workspaceId,
        limit: 50
      });
      const metrics = await gadsCampaignMetrics({
        workspaceId: opts.workspaceId,
        datePreset:
          opts.datePreset === "last_7_days"
            ? "LAST_7_DAYS"
            : opts.datePreset === "last_90_days"
              ? "LAST_90_DAYS"
              : "LAST_30_DAYS",
        since: opts.since,
        until: opts.until
      });
      const totalCost = metrics.reduce((a, m) => a + m.costEur, 0);
      const totalConv = metrics.reduce((a, m) => a + m.conversions, 0);
      summaryLines.push(
        `## Google Ads`,
        `- Campañas: **${campaigns.length}**`,
        `- Gasto total periodo: **${totalCost.toFixed(2)} €**`,
        `- Conversiones: **${totalConv.toFixed(0)}**`,
        ""
      );
      sheets.push({
        name: "GAds - Campañas",
        title: "Campañas Google Ads",
        rows: campaigns
      });
      sheets.push({
        name: "GAds - Métricas",
        title: "Rendimiento Google Ads",
        subtitle: `Periodo: ${period}`,
        rows: metrics,
        columnLabels: {
          campaignId: "ID",
          campaignName: "Campaña",
          impressions: "Impresiones",
          clicks: "Clicks",
          costEur: "Coste (€)",
          ctr: "CTR",
          cpcEur: "CPC (€)",
          conversions: "Conversiones",
          conversionsValue: "Valor conv. (€)"
        }
      });
      sources.googleAds = "ok";
    } catch (e: any) {
      sources.googleAds = e?.message ?? String(e);
      summaryLines.push(`> ⚠️ Google Ads no disponible: ${sources.googleAds}`, "");
    }
  }

  if (sheets.length === 0) {
    sheets.push({
      name: "Sin datos",
      title: "Informe sin datos",
      rows: [{ mensaje: "Ninguna fuente de datos respondió. Revisa configuración." }]
    });
  }

  const buffer = await buildStyledXlsx({
    theme: "corporate",
    primaryColor: opts.primaryColor,
    meta: {
      title: `Informe ${clientLabel} — ${period}`,
      subject: "Informe mensual",
      creator: "Sonia (Hub)",
      company: clientLabel
    },
    sheets
  });

  const filename = `informe-${(opts.clientName ?? "cliente")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}-${period.replace(/[^a-zA-Z0-9]+/g, "-")}.xlsx`;

  return {
    filename,
    buffer,
    summary: summaryLines.join("\n"),
    sources
  };
}
