/**
 * Macro: resumen semanal de redes sociales para un cliente.
 *
 * Combina:
 *   - Metricool: stats por red social (instagram, facebook, tiktok,
 *     linkedin, twitter, gmb) en los últimos 7 días.
 *   - Meta Ads: campañas activas + spend + leads de la semana.
 *   - GMB insights (si está configurado): impresiones + acciones.
 *
 * Devuelve un mensaje markdown listo para mandar al cliente por
 * WhatsApp o email. Tono coloquial — semanal, no académico. Si una
 * fuente falla, se omite en silencio (best-effort).
 *
 * El caller (la tool en tools.ts) decide qué hacer con el resultado:
 * publicar como comentario, mandar WhatsApp, ambos.
 */

import { metricoolGetStats } from "@/lib/integrations/metricool";
import {
  metaAdsListCampaigns,
  metaAdsGetCampaignInsights
} from "@/lib/integrations/meta-ads";
import { gmbGetInsights } from "@/lib/integrations/gmb";
import { prisma } from "@/lib/db/prisma";

export type WeeklySummaryOpts = {
  workspaceId: string;
  clientId?: string;
  /** Default: instagram, facebook, gmb */
  networks?: Array<"instagram" | "facebook" | "tiktok" | "linkedin" | "twitter" | "gmb">;
  /** Si true, omitimos Meta Ads en el resumen (cliente sin campañas). */
  skipMetaAds?: boolean;
};

export type WeeklySummaryResult = {
  summary: string;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  sources: Record<string, "ok" | "skipped" | string>;
};

export async function generateWeeklySocialSummary(
  opts: WeeklySummaryOpts
): Promise<WeeklySummaryResult> {
  const networks = opts.networks ?? ["instagram", "facebook", "gmb"];
  const sources: WeeklySummaryResult["sources"] = {};
  const lines: string[] = [];

  let clientName: string | null = null;
  let clientPhone: string | null = null;
  let clientEmail: string | null = null;

  if (opts.clientId) {
    const c = await prisma.client.findFirst({
      where: { id: opts.clientId, workspaceId: opts.workspaceId },
      select: { name: true, phone: true, email: true }
    });
    if (c) {
      clientName = c.name;
      clientPhone = c.phone;
      clientEmail = c.email;
    }
  }

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 86400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const period = `${fmt(weekAgo)} → ${fmt(today)}`;

  lines.push(`📊 *Resumen semanal${clientName ? ` — ${clientName}` : ""}*`);
  lines.push(`_Periodo: ${period}_`);
  lines.push("");

  // ── Metricool por red ─────────────────────────────────────────────
  for (const network of networks.filter((n) => n !== "gmb")) {
    try {
      const stats = await metricoolGetStats({
        workspaceId: opts.workspaceId,
        network: network as any,
        from: fmt(weekAgo),
        to: fmt(today)
      });
      // Metricool devuelve estructura por red. Extraemos métricas
      // comunes con safe-access.
      const totalEngagement = pickNumber(stats, ["engagement", "totals.engagement"]);
      const totalReach = pickNumber(stats, ["reach", "totals.reach", "impressions"]);
      const newFollowers = pickNumber(stats, [
        "followersGained",
        "totals.followersGained",
        "newFollowers"
      ]);
      const postsCount = pickNumber(stats, [
        "publishedPosts",
        "totals.posts",
        "postsCount"
      ]);

      const emoji = NETWORK_EMOJI[network] ?? "📱";
      lines.push(`${emoji} *${capitalize(network)}*`);
      if (postsCount !== null) lines.push(`• Publicaciones: ${postsCount}`);
      if (totalReach !== null) lines.push(`• Alcance: ${formatNum(totalReach)}`);
      if (totalEngagement !== null)
        lines.push(`• Interacciones: ${formatNum(totalEngagement)}`);
      if (newFollowers !== null && newFollowers !== 0)
        lines.push(
          `• Seguidores: ${newFollowers > 0 ? "+" : ""}${formatNum(newFollowers)}`
        );
      lines.push("");
      sources[network] = "ok";
    } catch (e: any) {
      sources[network] = e?.message ?? String(e);
      // No spammeamos el resumen con errores — se reportan solo en
      // sources para el caller.
    }
  }

  // ── GMB ───────────────────────────────────────────────────────────
  if (networks.includes("gmb")) {
    try {
      const insights = await gmbGetInsights({
        workspaceId: opts.workspaceId,
        clientId: opts.clientId,
        since: fmt(weekAgo),
        until: fmt(today)
      });
      const s = insights.summary;
      const impressions =
        (Number(s.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0) +
          Number(s.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0) +
          Number(s.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0) +
          Number(s.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0));
      const calls = Number(s.CALL_CLICKS ?? 0);
      const directions = Number(s.BUSINESS_DIRECTION_REQUESTS ?? 0);
      const websiteClicks = Number(s.WEBSITE_CLICKS ?? 0);

      lines.push(`📍 *Google Business*`);
      if (impressions > 0) lines.push(`• Impresiones (mapa+búsqueda): ${formatNum(impressions)}`);
      if (calls > 0) lines.push(`• Llamadas desde la ficha: ${calls}`);
      if (directions > 0) lines.push(`• Peticiones de cómo llegar: ${directions}`);
      if (websiteClicks > 0) lines.push(`• Clics a la web: ${websiteClicks}`);
      lines.push("");
      sources.gmb = "ok";
    } catch (e: any) {
      sources.gmb = e?.message ?? String(e);
    }
  }

  // ── Meta Ads ──────────────────────────────────────────────────────
  if (!opts.skipMetaAds) {
    try {
      const campaigns = await metaAdsListCampaigns({
        workspaceId: opts.workspaceId,
        status: "ACTIVE"
      });
      const top = campaigns.slice(0, 10);
      let totalSpend = 0;
      let totalImpr = 0;
      let totalClicks = 0;
      let totalLeads = 0;
      for (const c of top) {
        try {
          const ins = await metaAdsGetCampaignInsights({
            workspaceId: opts.workspaceId,
            campaignId: c.id,
            datePreset: "last_7d"
          });
          totalSpend += Number((ins as any)?.spend ?? 0);
          totalImpr += Number((ins as any)?.impressions ?? 0);
          totalClicks += Number((ins as any)?.clicks ?? 0);
          // Leads suele estar en actions[].action_type='lead'
          const actions = (ins as any)?.actions ?? [];
          const leadAction = Array.isArray(actions)
            ? actions.find((a: any) => a.action_type === "lead")
            : null;
          if (leadAction) totalLeads += Number(leadAction.value ?? 0);
        } catch {
          // Skip campañas con error puntual
        }
      }
      if (campaigns.length > 0) {
        lines.push(`📢 *Meta Ads*`);
        lines.push(`• Campañas activas: ${campaigns.length}`);
        if (totalSpend > 0) lines.push(`• Gasto semana: ${totalSpend.toFixed(2)}€`);
        if (totalImpr > 0) lines.push(`• Impresiones: ${formatNum(totalImpr)}`);
        if (totalClicks > 0) lines.push(`• Clics: ${formatNum(totalClicks)}`);
        if (totalLeads > 0)
          lines.push(
            `• Leads captados: ${totalLeads} (CPL ${(totalSpend / totalLeads).toFixed(2)}€)`
          );
        lines.push("");
      }
      sources.metaAds = "ok";
    } catch (e: any) {
      sources.metaAds = e?.message ?? String(e);
    }
  }

  // Si todas las fuentes fallaron, lo decimos honestamente
  const anyOk = Object.values(sources).some((v) => v === "ok");
  if (!anyOk) {
    lines.push(
      "_(No he podido recopilar datos esta semana — voy a investigar y vuelvo.)_"
    );
  } else {
    lines.push("_Cualquier duda, dime y profundizamos._");
  }

  return {
    summary: lines.join("\n"),
    clientName,
    clientPhone,
    clientEmail,
    sources
  };
}

const NETWORK_EMOJI: Record<string, string> = {
  instagram: "📸",
  facebook: "📘",
  tiktok: "🎵",
  linkedin: "💼",
  twitter: "🐦",
  gmb: "📍"
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function formatNum(n: number): string {
  if (Math.abs(n) >= 1000)
    return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "")}k`;
  return String(Math.round(n));
}
function pickNumber(obj: any, paths: string[]): number | null {
  for (const p of paths) {
    const parts = p.split(".");
    let cur: any = obj;
    for (const k of parts) {
      cur = cur?.[k];
      if (cur === undefined || cur === null) break;
    }
    const n = Number(cur);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}
