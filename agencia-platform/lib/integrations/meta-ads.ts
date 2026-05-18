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

/**
 * Resuelve token + adAccountId para Meta Ads. Si `adhoc` viene con
 * META_ADS_TOKEN y/o META_ADS_AD_ACCOUNT_ID, GANAN sobre la
 * configuración cifrada del workspace. Útil cuando la integración
 * oficial caducó y el user pegó un token temporal en el task.
 *
 * Mezcla parcial: si solo viene el token (pero no el adAccountId),
 * usamos el adAccountId del workspace y el token del adhoc — y al
 * revés.
 */
async function getMetaAdsConfig(
  workspaceId: string,
  adhoc?: Record<string, string>
): Promise<{
  accessToken: string;
  adAccountId: string;
}> {
  const adhocToken = adhoc?.META_ADS_TOKEN;
  const adhocAccount = adhoc?.META_ADS_AD_ACCOUNT_ID;

  let accessToken: string | null = null;
  let adAccountId: string | null = null;

  if (adhocToken) {
    accessToken = adhocToken;
  } else {
    // Cogemos cualquier MetaConnection viva del workspace (la primera).
    const conn = await prisma.metaConnection.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: "desc" }
    });
    if (!conn) throw new Error("MetaConnection no configurada en el workspace (y no hay META_ADS_TOKEN ad-hoc en la tarea)");
    if (conn.expiresAt && conn.expiresAt < new Date()) {
      throw new Error("MetaConnection caducada — reconecta Meta o pega un META_ADS_TOKEN temporal en la tarea");
    }
    accessToken = decryptSecret(conn.accessTokenEnc);
    if (!accessToken) throw new Error("MetaConnection token inválido");
  }

  if (adhocAccount) {
    adAccountId = adhocAccount;
  } else {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    adAccountId = (ws?.settings as any)?.integrations?.metaAds?.adAccountId ?? null;
    if (!adAccountId) {
      throw new Error("Falta adAccountId — añade META_ADS_AD_ACCOUNT_ID en la tarea o configura settings.integrations.metaAds");
    }
  }

  return { accessToken, adAccountId };
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

export async function metaAdsListAdAccounts(workspaceId: string, adhoc?: Record<string, string>) {
  let token: string | null = adhoc?.META_ADS_TOKEN ?? null;
  if (!token) {
    const conn = await prisma.metaConnection.findFirst({ where: { workspaceId } });
    if (!conn) throw new Error("MetaConnection no configurada");
    token = decryptSecret(conn.accessTokenEnc);
    if (!token) throw new Error("token inválido");
  }
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
  adhoc?: Record<string, string>;
}) {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
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
  adhoc?: Record<string, string>;
}) {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
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
  adhoc?: Record<string, string>;
}) {
  const campaigns = await metaAdsListCampaigns({
    workspaceId: opts.workspaceId,
    status: "ACTIVE",
    limit: 50,
    adhoc: opts.adhoc
  });
  const metric = opts.metric ?? "spend";
  const datePreset = opts.datePreset ?? "last_30d";
  const enriched = [];
  for (const c of campaigns.slice(0, 20)) {
    try {
      const ins = await metaAdsGetCampaignInsights({
        workspaceId: opts.workspaceId,
        campaignId: c.id,
        datePreset,
        adhoc: opts.adhoc
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

/**
 * Lista los ads hijos de una campaña o adset, para luego pedir
 * leads de cada uno.
 */
export async function metaAdsListAds(opts: {
  workspaceId: string;
  campaignId?: string;
  adsetId?: string;
  adhoc?: Record<string, string>;
  limit?: number;
}) {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  let parent: string;
  if (opts.adsetId) parent = opts.adsetId;
  else if (opts.campaignId) parent = opts.campaignId;
  else throw new Error("Pasa campaignId o adsetId");
  const params = new URLSearchParams({
    fields: "id,name,status,adset_id,campaign_id,creative",
    limit: String(opts.limit ?? 200)
  });
  const data = await metaFetch<any>(
    `${GRAPH}/${parent}/ads?${params.toString()}`,
    cfg.accessToken
  );
  return data.data ?? [];
}

/**
 * Descarga los leads (personas que rellenaron un formulario de
 * Lead Ads) de una campaña, adset, ad o form concreto. Devuelve
 * un array plano con created_time + cada campo del formulario
 * como columna (nombre, email, teléfono, etc.).
 *
 * La API de Meta da los leads en `field_data: [{name, values:[v]}]`.
 * Aquí lo aplanamos para que sea fácilmente exportable a CSV.
 *
 * Si pasas campaignId/adsetId, recorre todos sus ads hijos y agrega
 * los leads de cada uno. Si pasas formId, va directo al form.
 * Filtra por rango de fechas (since/until) en created_time.
 *
 * Tope duro: 5000 leads por llamada (paginación con cursor next).
 * Para volúmenes mayores, pedir por adId individual o reducir el
 * rango de fechas.
 */
export async function metaAdsDownloadLeads(opts: {
  workspaceId: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  formId?: string;
  since?: string; // YYYY-MM-DD
  until?: string;
  adhoc?: Record<string, string>;
}): Promise<{
  count: number;
  leads: Array<Record<string, string>>;
  source: string;
}> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);

  // 1) Resolver las "fuentes" de leads. Si es campaignId o adsetId,
  //    listamos los ads hijos. Si es adId o formId, directo.
  let adIds: string[] = [];
  if (opts.adId) {
    adIds = [opts.adId];
  } else if (opts.adsetId) {
    const ads = await metaAdsListAds({
      workspaceId: opts.workspaceId,
      adsetId: opts.adsetId,
      adhoc: opts.adhoc
    });
    adIds = ads.map((a: any) => a.id);
  } else if (opts.campaignId) {
    const ads = await metaAdsListAds({
      workspaceId: opts.workspaceId,
      campaignId: opts.campaignId,
      adhoc: opts.adhoc
    });
    adIds = ads.map((a: any) => a.id);
  } else if (!opts.formId) {
    throw new Error(
      "Debes pasar uno de: campaignId, adsetId, adId, formId"
    );
  }

  const sinceTs = opts.since ? Math.floor(new Date(opts.since).getTime() / 1000) : null;
  const untilTs = opts.until ? Math.floor((new Date(opts.until).getTime() + 86_400_000) / 1000) : null;

  // 2) Recorrer cada source y descargar leads paginando.
  const allLeads: Array<Record<string, string>> = [];
  const sources = opts.formId ? [`form:${opts.formId}`] : adIds.map((id) => `ad:${id}`);
  const HARD_LIMIT = 5000;

  for (const source of sources) {
    if (allLeads.length >= HARD_LIMIT) break;
    const [kind, id] = source.split(":");
    const path = kind === "form" ? `/${id}/leads` : `/${id}/leads`;
    const params = new URLSearchParams({
      fields: "id,created_time,field_data,ad_id,form_id,campaign_id,adset_id",
      limit: "200"
    });
    if (sinceTs) {
      params.set(
        "filtering",
        JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: sinceTs }])
      );
    }
    let url = `${GRAPH}${path}?${params.toString()}`;
    while (url && allLeads.length < HARD_LIMIT) {
      const resp: any = await metaFetch(url, cfg.accessToken);
      const items = resp.data ?? [];
      for (const lead of items) {
        if (untilTs && lead.created_time) {
          const ts = Math.floor(new Date(lead.created_time).getTime() / 1000);
          if (ts > untilTs) continue;
        }
        // Aplanar field_data → un objeto plano con cada campo como columna.
        const row: Record<string, string> = {
          lead_id: lead.id,
          created_time: lead.created_time ?? "",
          ad_id: lead.ad_id ?? "",
          form_id: lead.form_id ?? "",
          campaign_id: lead.campaign_id ?? "",
          adset_id: lead.adset_id ?? ""
        };
        for (const fd of lead.field_data ?? []) {
          const colName = String(fd.name ?? "").trim();
          if (!colName) continue;
          const val = Array.isArray(fd.values) ? fd.values.join("; ") : String(fd.values ?? "");
          row[colName] = val;
        }
        allLeads.push(row);
      }
      // Paginación con next cursor.
      url = resp.paging?.next ?? "";
    }
  }

  return {
    count: allLeads.length,
    leads: allLeads,
    source: opts.formId
      ? `form:${opts.formId}`
      : opts.adId
        ? `ad:${opts.adId}`
        : opts.adsetId
          ? `adset:${opts.adsetId}`
          : `campaign:${opts.campaignId}`
  };
}

/** Helper: convierte un array de objetos a CSV con escape RFC 4180. */
export function leadsToCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return "";
  // Recolectar todas las columnas (la unión de keys de todas las filas).
  const allKeys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) allKeys.add(k);
  // Orden: meta-fields primero, luego el resto alfabético.
  const metaOrder = ["created_time", "lead_id", "ad_id", "form_id", "campaign_id", "adset_id"];
  const headers = [
    ...metaOrder.filter((k) => allKeys.has(k)),
    ...Array.from(allKeys).filter((k) => !metaOrder.includes(k)).sort()
  ];
  function esc(v: unknown): string {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}
