/**
 * Cliente Google Ads minimal — Fase 52.
 *
 * Requiere 3 piezas:
 *   1. GOOGLE_ADS_DEVELOPER_TOKEN (env var compartido del server,
 *      obtenido en ads.google.com → Tools → API Center)
 *   2. GoogleAdsConnection del workspace:
 *      - refreshToken (OAuth2 — obtenido tras consentimiento user)
 *      - customerId (cuenta de Google Ads a consultar)
 *      - loginCustomerId (opcional, si gestionas desde MCC)
 *   3. OAuth client_id + client_secret en env vars:
 *      - GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET
 *      (puedes reutilizar los de Google OAuth de la plataforma si
 *      añadiste el scope adwords/ads en consent screen)
 *
 * Para Fase 52 implementamos lectura (campaigns + métricas via GAQL).
 *
 * Docs: https://developers.google.com/google-ads/api/rest
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const API_VERSION = "v17"; // estable a fecha de implementación
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const BASE = `https://googleads.googleapis.com/${API_VERSION}`;

async function getAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_ADS_CLIENT_ID / SECRET no configurados en env");
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token"
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Google OAuth refresh ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  return data.access_token as string;
}

async function getConnConfig(workspaceId: string) {
  const conn = await prisma.googleAdsConnection.findUnique({
    where: { workspaceId }
  });
  if (!conn) throw new Error("GoogleAdsConnection no configurada");
  const refreshToken = decryptSecret(conn.refreshTokenEnc);
  if (!refreshToken) throw new Error("refresh token Google Ads inválido");
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN no en env");
  return {
    refreshToken,
    devToken,
    customerId: conn.customerId,
    loginCustomerId: conn.loginCustomerId ?? null
  };
}

async function gadsQuery(opts: { workspaceId: string; gaql: string }): Promise<any[]> {
  const cfg = await getConnConfig(opts.workspaceId);
  const accessToken = await getAccessToken(cfg.refreshToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": cfg.devToken,
    "Content-Type": "application/json"
  };
  if (cfg.loginCustomerId) headers["login-customer-id"] = cfg.loginCustomerId;
  const r = await fetch(
    `${BASE}/customers/${cfg.customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ query: opts.gaql })
    }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Google Ads ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  // searchStream devuelve un array de batches con results
  const results: any[] = [];
  for (const batch of Array.isArray(data) ? data : [data]) {
    for (const row of batch?.results ?? []) results.push(row);
  }
  return results;
}

export async function gadsListCampaigns(opts: {
  workspaceId: string;
  status?: "ENABLED" | "PAUSED" | "REMOVED";
  limit?: number;
}) {
  const where = opts.status ? `WHERE campaign.status = '${opts.status}'` : "";
  const limit = opts.limit ?? 50;
  const gaql = `
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign_budget.amount_micros, campaign.start_date, campaign.end_date
    FROM campaign
    ${where}
    ORDER BY campaign.id
    LIMIT ${limit}
  `;
  const rows = await gadsQuery({ workspaceId: opts.workspaceId, gaql });
  return rows.map((r) => ({
    id: r.campaign?.id,
    name: r.campaign?.name,
    status: r.campaign?.status,
    type: r.campaign?.advertisingChannelType,
    budgetEur: r.campaignBudget?.amountMicros
      ? Number(r.campaignBudget.amountMicros) / 1_000_000
      : null,
    startDate: r.campaign?.startDate,
    endDate: r.campaign?.endDate
  }));
}

export async function gadsCampaignMetrics(opts: {
  workspaceId: string;
  /** "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_90_DAYS" o {since, until} ISO */
  datePreset?: string;
  since?: string;
  until?: string;
  campaignId?: string;
}) {
  const where: string[] = [];
  if (opts.campaignId) where.push(`campaign.id = ${opts.campaignId}`);
  if (opts.since && opts.until) {
    where.push(`segments.date BETWEEN '${opts.since}' AND '${opts.until}'`);
  } else {
    where.push(`segments.date DURING ${opts.datePreset ?? "LAST_30_DAYS"}`);
  }
  const gaql = `
    SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks,
           metrics.cost_micros, metrics.ctr, metrics.average_cpc,
           metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE ${where.join(" AND ")}
  `;
  const rows = await gadsQuery({ workspaceId: opts.workspaceId, gaql });
  return rows.map((r) => ({
    campaignId: r.campaign?.id,
    campaignName: r.campaign?.name,
    impressions: Number(r.metrics?.impressions ?? 0),
    clicks: Number(r.metrics?.clicks ?? 0),
    costEur: r.metrics?.costMicros ? Number(r.metrics.costMicros) / 1_000_000 : 0,
    ctr: Number(r.metrics?.ctr ?? 0),
    cpcEur: r.metrics?.averageCpc ? Number(r.metrics.averageCpc) / 1_000_000 : 0,
    conversions: Number(r.metrics?.conversions ?? 0),
    conversionsValue: Number(r.metrics?.conversionsValue ?? 0)
  }));
}

export async function gadsTest(workspaceId: string): Promise<{
  ok: true;
  customerId: string;
  campaignsSample: number;
}> {
  const cfg = await getConnConfig(workspaceId);
  const campaigns = await gadsListCampaigns({ workspaceId, limit: 5 });
  return { ok: true, customerId: cfg.customerId, campaignsSample: campaigns.length };
}
