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

const API_VERSION = "v25";
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

export type GoogleAdsInvoice = {
  id: string;
  number: string;
  issueDate: string;
  totalAmountMicros: number;
  currency: string;
  pdfUrl: string;
};

export function normalizeGoogleAdsInvoices(payload: any): GoogleAdsInvoice[] {
  const rows = Array.isArray(payload?.invoices) ? payload.invoices : [];
  return rows.filter((invoice: any) => invoice?.pdfUrl).map((invoice: any) => ({
    id: invoice.resourceName || invoice.id || invoice.invoiceId,
    number: invoice.id || invoice.invoiceId || String(invoice.resourceName || "").split("/").pop(),
    issueDate: invoice.issueDate || "",
    totalAmountMicros: Number(invoice.totalAmountMicros || 0),
    currency: invoice.currencyCode || "EUR",
    pdfUrl: invoice.pdfUrl
  }));
}

function digits(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Lista las facturas oficiales de una cuenta con facturación mensual.
 * Google exige indicar el billing setup y el manager pagador.
 */
export async function gadsListInvoices(opts: {
  workspaceId: string;
  customerId: string;
  issueYear: number;
  issueMonth: number;
  loginCustomerId?: string | null;
}): Promise<GoogleAdsInvoice[]> {
  const cfg = await getConnConfig(opts.workspaceId);
  const customerId = digits(opts.customerId);
  if (!customerId) throw new Error("ID de cliente de Google Ads no válido");
  const accessToken = await getAccessToken(cfg.refreshToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": cfg.devToken
  };
  const loginCustomerId = digits(opts.loginCustomerId || cfg.loginCustomerId);
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

  const setupsResponse = await fetch(`${BASE}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "SELECT billing_setup.resource_name FROM billing_setup" })
  });
  if (!setupsResponse.ok) {
    const detail = await setupsResponse.text();
    throw new Error(`Google Ads billing setups ${setupsResponse.status}: ${detail.slice(0, 300)}`);
  }
  const setupBatches = await setupsResponse.json();
  const resources = (Array.isArray(setupBatches) ? setupBatches : [setupBatches])
    .flatMap((batch: any) => batch.results || [])
    .map((row: any) => row.billingSetup?.resourceName)
    .filter(Boolean);
  if (!resources.length) throw new Error("La cuenta no tiene una configuración de facturación mensual accesible por API");

  const invoices: GoogleAdsInvoice[] = [];
  for (const billingSetup of resources) {
    const query = new URLSearchParams({
      billingSetup,
      issueYear: String(opts.issueYear),
      issueMonth: String(opts.issueMonth)
    });
    const response = await fetch(`${BASE}/customers/${customerId}/invoices:list?${query}`, { headers });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google Ads invoices ${response.status}: ${detail.slice(0, 300)}`);
    }
    const data = await response.json();
    invoices.push(...normalizeGoogleAdsInvoices(data));
  }
  return [...new Map(invoices.map((invoice) => [invoice.id, invoice])).values()];
}

export async function gadsDownloadInvoicePdf(opts: { workspaceId: string; invoice: GoogleAdsInvoice }) {
  const cfg = await getConnConfig(opts.workspaceId);
  const accessToken = await getAccessToken(cfg.refreshToken);
  const response = await fetch(opts.invoice.pdfUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google Ads PDF ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.subarray(0, 4).toString("ascii") !== "%PDF") throw new Error("Google Ads no devolvió un PDF válido");
  return buffer;
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

// ────────────────────────────────────────────────────────────────────
// WRITE — mutate endpoint.
//
// Filosofía: TODO se crea en PAUSED. El humano revisa y activa
// manualmente desde Google Ads (o pide a Sonia un update_campaign_status
// → ENABLED tras validar).
// ────────────────────────────────────────────────────────────────────

async function gadsMutate(opts: {
  workspaceId: string;
  resourceType:
    | "campaignBudgets"
    | "campaigns"
    | "adGroups"
    | "adGroupCriteria"
    | "adGroupAds";
  operations: any[];
}): Promise<any> {
  const cfg = await getConnConfig(opts.workspaceId);
  const accessToken = await getAccessToken(cfg.refreshToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": cfg.devToken,
    "Content-Type": "application/json"
  };
  if (cfg.loginCustomerId) headers["login-customer-id"] = cfg.loginCustomerId;
  const url = `${BASE}/customers/${cfg.customerId}/${opts.resourceType}:mutate`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ operations: opts.operations })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Google Ads mutate ${r.status}: ${t.slice(0, 400)}`);
  }
  return r.json();
}

function eurosToMicros(eur: number): number {
  return Math.round(eur * 1_000_000);
}

export async function gadsCreateCampaignBudget(opts: {
  workspaceId: string;
  name: string;
  amountEurDaily: number;
  deliveryMethod?: "STANDARD" | "ACCELERATED";
}): Promise<{ resourceName: string; budgetId: string }> {
  const result = await gadsMutate({
    workspaceId: opts.workspaceId,
    resourceType: "campaignBudgets",
    operations: [
      {
        create: {
          name: opts.name,
          amountMicros: eurosToMicros(opts.amountEurDaily),
          deliveryMethod: opts.deliveryMethod ?? "STANDARD",
          explicitlyShared: false
        }
      }
    ]
  });
  const rn = result.results?.[0]?.resourceName as string;
  return { resourceName: rn, budgetId: rn?.split("/").pop() ?? "" };
}

export async function gadsCreateCampaign(opts: {
  workspaceId: string;
  name: string;
  budgetResourceName: string;
  channelType?: "SEARCH" | "DISPLAY" | "PERFORMANCE_MAX";
  /** Mantener PAUSED por defecto: el humano valida antes de gastar. */
  status?: "ENABLED" | "PAUSED";
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
}): Promise<{ resourceName: string; campaignId: string }> {
  const result = await gadsMutate({
    workspaceId: opts.workspaceId,
    resourceType: "campaigns",
    operations: [
      {
        create: {
          name: opts.name,
          status: opts.status ?? "PAUSED",
          advertisingChannelType: opts.channelType ?? "SEARCH",
          campaignBudget: opts.budgetResourceName,
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: true,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false
          },
          manualCpc: { enhancedCpcEnabled: false },
          startDate: opts.startDate,
          endDate: opts.endDate
        }
      }
    ]
  });
  const rn = result.results?.[0]?.resourceName as string;
  return { resourceName: rn, campaignId: rn?.split("/").pop() ?? "" };
}

export async function gadsUpdateCampaignStatus(opts: {
  workspaceId: string;
  campaignId: string;
  status: "ENABLED" | "PAUSED" | "REMOVED";
}): Promise<{ resourceName: string }> {
  const cfg = await getConnConfig(opts.workspaceId);
  const result = await gadsMutate({
    workspaceId: opts.workspaceId,
    resourceType: "campaigns",
    operations: [
      {
        update: {
          resourceName: `customers/${cfg.customerId}/campaigns/${opts.campaignId}`,
          status: opts.status
        },
        updateMask: "status"
      }
    ]
  });
  return { resourceName: result.results?.[0]?.resourceName };
}

export async function gadsUpdateBudget(opts: {
  workspaceId: string;
  budgetId: string;
  amountEurDaily: number;
}): Promise<{ resourceName: string }> {
  const cfg = await getConnConfig(opts.workspaceId);
  const result = await gadsMutate({
    workspaceId: opts.workspaceId,
    resourceType: "campaignBudgets",
    operations: [
      {
        update: {
          resourceName: `customers/${cfg.customerId}/campaignBudgets/${opts.budgetId}`,
          amountMicros: eurosToMicros(opts.amountEurDaily)
        },
        updateMask: "amount_micros"
      }
    ]
  });
  return { resourceName: result.results?.[0]?.resourceName };
}

export async function gadsCreateAdGroup(opts: {
  workspaceId: string;
  campaignId: string;
  name: string;
  cpcBidEur?: number;
  status?: "ENABLED" | "PAUSED";
}): Promise<{ resourceName: string; adGroupId: string }> {
  const cfg = await getConnConfig(opts.workspaceId);
  const result = await gadsMutate({
    workspaceId: opts.workspaceId,
    resourceType: "adGroups",
    operations: [
      {
        create: {
          name: opts.name,
          campaign: `customers/${cfg.customerId}/campaigns/${opts.campaignId}`,
          status: opts.status ?? "PAUSED",
          type: "SEARCH_STANDARD",
          cpcBidMicros: opts.cpcBidEur ? eurosToMicros(opts.cpcBidEur) : undefined
        }
      }
    ]
  });
  const rn = result.results?.[0]?.resourceName as string;
  return { resourceName: rn, adGroupId: rn?.split("/").pop() ?? "" };
}

export async function gadsCreateKeywords(opts: {
  workspaceId: string;
  adGroupId: string;
  keywords: Array<{
    text: string;
    matchType?: "EXACT" | "PHRASE" | "BROAD";
  }>;
}): Promise<{ created: number; resourceNames: string[] }> {
  const cfg = await getConnConfig(opts.workspaceId);
  const operations = opts.keywords.map((kw) => ({
    create: {
      adGroup: `customers/${cfg.customerId}/adGroups/${opts.adGroupId}`,
      status: "ENABLED",
      keyword: {
        text: kw.text,
        matchType: kw.matchType ?? "PHRASE"
      }
    }
  }));
  const result = await gadsMutate({
    workspaceId: opts.workspaceId,
    resourceType: "adGroupCriteria",
    operations
  });
  const rns = (result.results ?? []).map((r: any) => r.resourceName);
  return { created: rns.length, resourceNames: rns };
}

export async function gadsCreateResponsiveSearchAd(opts: {
  workspaceId: string;
  adGroupId: string;
  finalUrl: string;
  headlines: string[]; // 3-15
  descriptions: string[]; // 2-4
  path1?: string;
  path2?: string;
}): Promise<{ resourceName: string; adId: string }> {
  const cfg = await getConnConfig(opts.workspaceId);
  if (opts.headlines.length < 3) throw new Error("Mínimo 3 headlines requeridos");
  if (opts.descriptions.length < 2) throw new Error("Mínimo 2 descriptions requeridos");
  const result = await gadsMutate({
    workspaceId: opts.workspaceId,
    resourceType: "adGroupAds",
    operations: [
      {
        create: {
          adGroup: `customers/${cfg.customerId}/adGroups/${opts.adGroupId}`,
          status: "PAUSED",
          ad: {
            finalUrls: [opts.finalUrl],
            responsiveSearchAd: {
              headlines: opts.headlines.slice(0, 15).map((t) => ({ text: t.slice(0, 30) })),
              descriptions: opts.descriptions.slice(0, 4).map((t) => ({ text: t.slice(0, 90) })),
              path1: opts.path1?.slice(0, 15),
              path2: opts.path2?.slice(0, 15)
            }
          }
        }
      }
    ]
  });
  const rn = result.results?.[0]?.resourceName as string;
  return { resourceName: rn, adId: rn?.split("/").pop() ?? "" };
}
