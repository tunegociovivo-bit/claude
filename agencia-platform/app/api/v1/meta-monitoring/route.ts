import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { readMetaTokenByConnection } from "@/lib/meta/connection";
import { metaAdsGetAccountInsights, metaAdsGetCampaignDailyInsights, metaAdsGetCampaignInsights, metaAdsListAdsets, metaAdsListCampaigns } from "@/lib/integrations/meta-ads";
import { completeJson } from "@/lib/ai/anthropic";
import { buildFortnightBuckets, buildMonitoringRecommendations } from "@/lib/meta/monitoring";
import { metaResultActionCandidates, metaResultValue } from "@/lib/meta/results";

export const dynamic = "force-dynamic";

export const GET = withApi({}, async (req, { api }) => {
  const url = new URL(req.url); const accountId = url.searchParams.get("accountId"); const connectionId = url.searchParams.get("connectionId");
  if (!accountId || !/^act_\d+$/.test(accountId) || !connectionId) throw new ApiError(400, "invalid_account", "Selecciona una cuenta publicitaria");
  const since = url.searchParams.get("since"); const until = url.searchParams.get("until");
  if (!since || !until || !/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new ApiError(400, "invalid_period", "Indica un periodo de fechas válido");
  const sinceTime = Date.parse(`${since}T12:00:00Z`); const untilTime = Date.parse(`${until}T12:00:00Z`);
  const periodDays = Math.round((untilTime - sinceTime) / 86_400_000) + 1;
  if (!Number.isFinite(periodDays) || periodDays < 1 || periodDays > 90) throw new ApiError(400, "invalid_period", "El periodo debe tener entre 1 y 90 días");
  const token = await readMetaTokenByConnection(api.workspaceId, connectionId);
  if (!token) throw new ApiError(400, "meta_not_connected", "La conexión Meta ya no está disponible");
  const adhoc = { META_ADS_TOKEN: token, META_ADS_AD_ACCOUNT_ID: accountId };
  const listedCampaigns = await metaAdsListCampaigns({ workspaceId: api.workspaceId, status: "ACTIVE", statusField: "effective_status", limit: 50, adhoc });
  // Meta's `effective_status` can remain ACTIVE when a campaign has been
  // switched off in Ads Manager. The campaign toggle is represented by
  // `configured_status`; use it as the final source of truth for the count.
  const now = Date.now();
  const campaigns = listedCampaigns.filter((campaign: any) => {
    const startsAt = campaign.start_time ? Date.parse(campaign.start_time) : null;
    const stopsAt = campaign.stop_time ? Date.parse(campaign.stop_time) : null;
    return String(campaign.configured_status ?? "").toUpperCase() === "ACTIVE"
      && (!startsAt || Number.isNaN(startsAt) || startsAt <= now)
      && (!stopsAt || Number.isNaN(stopsAt) || stopsAt >= now);
  });
  const [accountTotals, enriched] = await Promise.all([
    metaAdsGetAccountInsights({ workspaceId: api.workspaceId, since, until, adhoc }),
    Promise.all(campaigns.slice(0, 12).map(async (campaign: any) => {
    const [adsets, totals] = await Promise.all([
      metaAdsListAdsets({ workspaceId: api.workspaceId, campaignId: String(campaign.id), adhoc }),
      metaAdsGetCampaignInsights({ workspaceId: api.workspaceId, campaignId: String(campaign.id), since, until, adhoc })
    ]);
    const resultActionTypes = metaResultActionCandidates(adsets, campaign.objective);
    const trendSinceDate = new Date(untilTime); trendSinceDate.setUTCDate(trendSinceDate.getUTCDate() - 89);
    const trendSince = trendSinceDate.toISOString().slice(0, 10);
    const daily = await metaAdsGetCampaignDailyInsights({ workspaceId: api.workspaceId, campaignId: String(campaign.id), since: trendSince, until, resultActionTypes, adhoc });
    const leads = metaResultValue(totals?.actions, resultActionTypes); const spend = Number(totals?.spend ?? 0);
    return { id: String(campaign.id), name: String(campaign.name), objective: campaign.objective, leads, spend, cpl: leads > 0 ? spend / leads : null, ctr: Number(totals?.ctr ?? 0), impressions: Number(totals?.impressions ?? 0), daily };
    }))
  ]);
  const buckets = buildFortnightBuckets(enriched.flatMap((campaign) => campaign.daily), new Date(`${until}T12:00:00Z`));
  const current = buckets.at(-1); const previous = buckets.at(-2);
  const leadChangePct = previous?.leads ? ((current?.leads ?? 0) - previous.leads) / previous.leads * 100 : null;
  const activeSpend = enriched.reduce((sum, item) => sum + item.spend, 0); const leads = enriched.reduce((sum, item) => sum + item.leads, 0);
  const spend = Number(accountTotals?.spend ?? 0);
  const recommendations = buildMonitoringRecommendations(enriched, leadChangePct);
  return NextResponse.json({ campaigns: enriched.map(({ daily: _daily, ...item }) => item).sort((a, b) => b.leads - a.leads), buckets, summary: { activeCampaigns: enriched.length, leads, spend, activeSpend, cpl: leads > 0 ? activeSpend / leads : null, leadChangePct }, recommendations, period: { since, until, days: periodDays }, verified: true, generatedAt: new Date().toISOString() });
});

const metric = z.number().finite();
const aiSchema = z.object({
  accountId: z.string().regex(/^act_\d+$/),
  connectionId: z.string().min(1).max(100),
  summary: z.object({ activeCampaigns: z.number().int().nonnegative(), leads: metric.nonnegative(), spend: metric.nonnegative(), cpl: metric.nonnegative().nullable(), leadChangePct: metric.nullable() }),
  campaigns: z.array(z.object({ id: z.string().max(100), name: z.string().max(300), objective: z.string().nullish(), leads: metric.nonnegative(), spend: metric.nonnegative(), cpl: metric.nonnegative().nullable(), ctr: metric.nonnegative(), impressions: metric.nonnegative() })).max(20)
});
export const POST = withApi({ rate: "ai" }, async (req, { api }) => {
  const parsed = aiSchema.safeParse(await req.json().catch(() => null)); if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const result = await completeJson<{ recommendations: Array<{ priority: string; title: string; rationale: string; action: string; confidence: number }> }>({ workspaceId: api.workspaceId, system: "Eres un especialista senior en Meta Ads. Analiza métricas sin inventar causas. Prioriza acciones con impacto, separa problemas de tracking de rendimiento y nunca recomiendes subir presupuesto si no hay conversiones fiables. Devuelve recomendaciones que requieren aprobación humana.", user: JSON.stringify({ summary: parsed.data.summary, campaigns: parsed.data.campaigns }), schema: { type: "object", properties: { recommendations: { type: "array", items: { type: "object", properties: { priority: { type: "string", enum: ["alta", "media", "baja"] }, title: { type: "string" }, rationale: { type: "string" }, action: { type: "string" }, confidence: { type: "number" } }, required: ["priority", "title", "rationale", "action", "confidence"], additionalProperties: false } } }, required: ["recommendations"], additionalProperties: false }, maxTokens: 1400 });
  return NextResponse.json(result);
});
