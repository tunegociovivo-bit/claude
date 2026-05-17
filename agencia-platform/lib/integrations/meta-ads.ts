/**
 * Cliente Meta Marketing API (Ads) — Fase 51.
 *
 * Reutilizamos la MetaConnection existente (que ya guarda
 * access_token de larga duración cifrado) y añadimos:
 *   - settings.integrations.metaAds.adAccountId (el "act_xxx" sin prefijo)
 *
 * Read-only — solo lectura de campañas + insights. Crear/modificar
 * ads ya lo hace lib/meta/campaigns.ts en el flow de generación.
 *
 * Docs: https://developers.facebook.com/docs/marketing-api
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const GRAPH = "https://graph.facebook.com/v19.0";

async function getMetaAdsConfig(workspaceId: string): Promise<{
  accessToken: string;
  adAccountId: string;
}> {
  // Cogemos cualquier MetaConnection viva del workspace (la primera).
  // En la práctica los workspaces tienen 1; si tuvieran varias,
  // sería trivial parametrizar.
  const conn = await prisma.metaConnection.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "desc" }
  });
  if (!conn) throw new Error("MetaConnection no configurada en el workspace");
  if (conn.expiresAt && conn.expiresAt < new Date()) {
    throw new Error("MetaConnection caducada — reconectar Meta");
  }
  const token = decryptSecret(conn.accessTokenEnc);
  if (!token) throw new Error("MetaConnection token inválido");

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const adAccountId = (ws?.settings as any)?.integrations?.metaAds?.adAccountId;
  if (!adAccountId) throw new Error("Falta adAccountId en settings.integrations.metaAds");
  return { accessToken: token, adAccountId };
}

async function metaFetch<T = any>(url: string, accessToken: string): Promise<T> {
  const u = url.includes("?")
    ? `${url}&access_token=${encodeURIComponent(accessToken)}`
    : `${url}?access_token=${encodeURIComponent(accessToken)}`;
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Meta Ads ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

export async function metaAdsListAdAccounts(workspaceId: string) {
  const conn = await prisma.metaConnection.findFirst({ where: { workspaceId } });
  if (!conn) throw new Error("MetaConnection no configurada");
  const token = decryptSecret(conn.accessTokenEnc);
  if (!token) throw new Error("token inválido");
  const data = await metaFetch<any>(
    `${GRAPH}/me/adaccounts?fields=id,name,account_status,currency,timezone_name`,
    token
  );
  return (data.data ?? []).map((a: any) => ({
    id: a.id, // formato "act_xxx"
    name: a.name,
    status: a.account_status,
    currency: a.currency,
    timezone: a.timezone_name
  }));
}

export async function metaAdsListCampaigns(opts: {
  workspaceId: string;
  status?: "ACTIVE" | "PAUSED" | "ARCHIVED";
  limit?: number;
}) {
  const cfg = await getMetaAdsConfig(opts.workspaceId);
  const account = cfg.adAccountId.startsWith("act_") ? cfg.adAccountId : `act_${cfg.adAccountId}`;
  const params = new URLSearchParams({
    fields: "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,buying_type",
    limit: String(opts.limit ?? 50)
  });
  if (opts.status) {
    params.set("effective_status", JSON.stringify([opts.status]));
  }
  const data = await metaFetch<any>(
    `${GRAPH}/${account}/campaigns?${params.toString()}`,
    cfg.accessToken
  );
  return data.data ?? [];
}

export async function metaAdsGetCampaignInsights(opts: {
  workspaceId: string;
  campaignId: string;
  /** "last_7d" | "last_30d" | "last_90d" o {since, until} ISO YYYY-MM-DD */
  datePreset?: string;
  since?: string;
  until?: string;
}) {
  const cfg = await getMetaAdsConfig(opts.workspaceId);
  const fields =
    "impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,action_values,date_start,date_stop";
  const params = new URLSearchParams({ fields });
  if (opts.since && opts.until) {
    params.set("time_range", JSON.stringify({ since: opts.since, until: opts.until }));
  } else {
    params.set("date_preset", opts.datePreset ?? "last_30d");
  }
  const data = await metaFetch<any>(
    `${GRAPH}/${opts.campaignId}/insights?${params.toString()}`,
    cfg.accessToken
  );
  // Devolvemos solo el primer "rollup" del rango — Meta puede partir
  // por dimensiones que no estamos pidiendo aquí.
  return (data.data ?? [])[0] ?? null;
}

export async function metaAdsTopPerformers(opts: {
  workspaceId: string;
  datePreset?: string; // default last_30d
  metric?: "impressions" | "spend" | "ctr" | "reach";
  limit?: number;
}) {
  const campaigns = await metaAdsListCampaigns({
    workspaceId: opts.workspaceId,
    status: "ACTIVE",
    limit: 50
  });
  const metric = opts.metric ?? "spend";
  const datePreset = opts.datePreset ?? "last_30d";
  const enriched = [];
  for (const c of campaigns.slice(0, 20)) {
    try {
      const ins = await metaAdsGetCampaignInsights({
        workspaceId: opts.workspaceId,
        campaignId: c.id,
        datePreset
      });
      enriched.push({ campaign: c, insights: ins ?? {} });
    } catch {
      enriched.push({ campaign: c, insights: null });
    }
  }
  enriched.sort((a, b) => {
    const va = Number((a.insights as any)?.[metric] ?? 0);
    const vb = Number((b.insights as any)?.[metric] ?? 0);
    return vb - va;
  });
  return enriched.slice(0, opts.limit ?? 10);
}
