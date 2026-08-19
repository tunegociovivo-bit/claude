import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { readMetaTokenByConnection } from "@/lib/meta/connection";
import { metaAdsGetCampaignDailyInsights, metaAdsGetCampaignInsights, metaAdsListCampaigns } from "@/lib/integrations/meta-ads";
import { completeJson } from "@/lib/ai/anthropic";
import { buildFortnightBuckets, buildMonitoringRecommendations } from "@/lib/meta/monitoring";

export const dynamic = "force-dynamic";

function leadCount(actions: any) {
  return Array.isArray(actions) ? actions.filter((action: any) => /lead/i.test(String(action.action_type ?? ""))).reduce((sum: number, action: any) => sum + Number(action.value ?? 0), 0) : 0;
}

export const GET = withApi({}, async (req, { api }) => {
  const url = new URL(req.url); const accountId = url.searchParams.get("accountId"); const connectionId = url.searchParams.get("connectionId");
  if (!accountId || !/^act_\d+$/.test(accountId) || !connectionId) throw new ApiError(400, "invalid_account", "Selecciona una cuenta publicitaria");
  const token = await readMetaTokenByConnection(api.workspaceId, connectionId);
  if (!token) throw new ApiError(400, "meta_not_connected", "La conexión Meta ya no está disponible");
  const adhoc = { META_ADS_TOKEN: token, META_ADS_AD_ACCOUNT_ID: accountId };
  const listedCampaigns = await metaAdsListCampaigns({ workspaceId: api.workspaceId, status: "ACTIVE", statusField: "effective_status", limit: 50, refreshStatuses: true, adhoc });
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
  const enriched = await Promise.all(campaigns.slice(0, 12).map(async (campaign: any) => {
    const [daily, totals] = await Promise.all([
      metaAdsGetCampaignDailyInsights({ workspaceId: api.workspaceId, campaignId: String(campaign.id), days: 90, adhoc }).catch(() => []),
      metaAdsGetCampaignInsights({ workspaceId: api.workspaceId, campaignId: String(campaign.id), datePreset: "last_30d", adhoc }).catch(() => null)
    ]);
    const leads = leadCount(totals?.actions); const spend = Number(totals?.spend ?? 0);
    return { id: String(campaign.id), name: String(campaign.name), objective: campaign.objective, leads, spend, cpl: leads > 0 ? spend / leads : null, ctr: Number(totals?.ctr ?? 0), impressions: Number(totals?.impressions ?? 0), daily };
  }));
  const buckets = buildFortnightBuckets(enriched.flatMap((campaign) => campaign.daily));
  const current = buckets.at(-1); const previous = buckets.at(-2);
  const leadChangePct = previous?.leads ? ((current?.leads ?? 0) - previous.leads) / previous.leads * 100 : null;
  const spend = enriched.reduce((sum, item) => sum + item.spend, 0); const leads = enriched.reduce((sum, item) => sum + item.leads, 0);
  const recommendations = buildMonitoringRecommendations(enriched, leadChangePct);
  return NextResponse.json({ campaigns: enriched.map(({ daily: _daily, ...item }) => item).sort((a, b) => b.leads - a.leads), buckets, summary: { activeCampaigns: enriched.length, leads, spend, cpl: leads > 0 ? spend / leads : null, leadChangePct }, recommendations, generatedAt: new Date().toISOString() });
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
