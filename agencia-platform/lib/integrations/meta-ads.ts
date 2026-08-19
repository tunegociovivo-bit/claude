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
import { loadStoredAdhocCredentials } from "@/lib/ai/nv-ia/adhoc-credentials";
import { metaWriteGate, noteMetaUsage, noteMetaErrorBody } from "@/lib/integrations/meta-rate-guard";

const GRAPH = "https://graph.facebook.com/v19.0";
const GRAPH_CAMPAIGN_STATUS = "https://graph.facebook.com/v23.0";

/**
 * Elige la MEJOR MetaConnection del workspace: la más reciente que NO esté
 * caducada (expiresAt null o futura). Si todas están caducadas, devuelve
 * la más reciente igualmente (para que el llamante dé un error claro).
 *
 * Por qué: puede haber varias conexiones (p.ej. una OAuth caducada + el
 * token System User que no caduca que el usuario pegó después). Antes
 * cogíamos "la más reciente" a secas y, si esa era la OAuth caducada,
 * fallaba aunque hubiera otra válida. Ahora todas las rutas (config,
 * token-only, list_ad_accounts) usan este mismo criterio → consistente.
 */
async function pickMetaConnection(workspaceId: string) {
  const conns = await prisma.metaConnection.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" }
  });
  if (conns.length === 0) return null;
  const now = new Date();
  const valid = conns.find((c) => !c.expiresAt || c.expiresAt > now);
  return valid ?? conns[0];
}

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
    // La mejor conexión NO caducada del workspace (prefiere el token que
    // no caduca sobre una OAuth vencida aunque ésta sea más reciente).
    const conn = await pickMetaConnection(workspaceId);
    if (conn && !(conn.expiresAt && conn.expiresAt < new Date())) {
      accessToken = decryptSecret(conn.accessTokenEnc);
    }
    // Fallback: el token permanente guardado como ad-hoc a nivel
    // workspace (System User que no caduca). Así, si el usuario no añade
    // su propio token, se usa el que ya hay guardado.
    if (!accessToken) {
      const stored = await loadStoredAdhocCredentials(workspaceId);
      if (stored.META_ADS_TOKEN) accessToken = stored.META_ADS_TOKEN;
    }
    if (!accessToken) {
      throw new Error(
        conn && conn.expiresAt && conn.expiresAt < new Date()
          ? "MetaConnection caducada — reconecta Meta o pega un token permanente en /campanas-meta"
          : "No hay token de Meta configurado — pega tu Access Token en /campanas-meta (Conexión Meta)"
      );
    }
  }

  if (adhocAccount) {
    adAccountId = adhocAccount;
  } else {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    adAccountId = (ws?.settings as any)?.integrations?.metaAds?.adAccountId ?? null;
    if (!adAccountId) {
      // Auto-resolución: no hay UI para configurar el Ad Account ID, así que
      // si el token tiene UNA sola cuenta publicitaria la usamos y la
      // persistimos. Si tiene varias, pedimos elegir; si ninguna, avisamos.
      const accounts = await metaAdsListAdAccounts(workspaceId, { META_ADS_TOKEN: accessToken });
      if (accounts.length === 1) {
        adAccountId = accounts[0].id; // formato "act_xxx"
        try {
          const settings = ((ws?.settings as any) ?? {}) as any;
          settings.integrations = settings.integrations ?? {};
          settings.integrations.metaAds = { ...(settings.integrations.metaAds ?? {}), adAccountId };
          await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
        } catch {
          /* persistencia best-effort */
        }
      } else if (accounts.length === 0) {
        throw new Error("El token de Meta no tiene acceso a ninguna cuenta publicitaria (Ad Account).");
      } else {
        // Auto-match por nombre del workspace cuando el token tiene
        // varias ad accounts (típico de System User tokens con acceso a
        // toda la cartera de la agencia: 47 cuentas en Eurosistema). Sin
        // este match, TODAS las tools meta_ads_* fallaban porque
        // getMetaAdsConfig tiraba el error "varias cuentas" antes de
        // siquiera intentar la operación. Bug detectado por Sonia
        // procesando la task "Campaña Eurosistema".
        const norm = (s: string) =>
          (s ?? "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "");
        const wsName = norm(ws?.name ?? "");
        let matched: { id: string; name: string } | null = null;
        if (wsName.length >= 3) {
          const hit =
            accounts.find((a: any) => norm(a.name) === wsName) ??
            accounts.find((a: any) => norm(a.name).includes(wsName)) ??
            accounts.find((a: any) => wsName.includes(norm(a.name)) && norm(a.name).length >= 3);
          if (hit) matched = { id: hit.id, name: hit.name };
        }
        if (matched) {
          adAccountId = matched.id;
          try {
            const settings = ((ws?.settings as any) ?? {}) as any;
            settings.integrations = settings.integrations ?? {};
            settings.integrations.metaAds = {
              ...(settings.integrations.metaAds ?? {}),
              adAccountId
            };
            await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
          } catch {
            /* persistencia best-effort */
          }
        } else {
          // Mostrar solo las primeras 10 para no llenar la respuesta
          // cuando el token tiene 47 cuentas (Eurosistema). El modelo
          // debe pasar META_ADS_AD_ACCOUNT_ID en adhoc o pedir al user.
          const sample = accounts.slice(0, 10).map((a: any) => `${a.name} (${a.id})`).join(", ");
          const more = accounts.length > 10 ? ` y ${accounts.length - 10} más` : "";
          throw new Error(
            `El token tiene ${accounts.length} cuentas publicitarias y ninguna coincide con el nombre del workspace ("${ws?.name ?? ""}"). Pásame el Ad Account ID (formato act_xxx) como META_ADS_AD_ACCOUNT_ID en adhoc. Ejemplos: ${sample}${more}.`
          );
        }
      }
    }
  }

  if (!adAccountId) throw new Error("No se pudo resolver la cuenta publicitaria de Meta.");
  return { accessToken, adAccountId };
}

/**
 * Resuelve SOLO el token de Meta (sin exigir cuenta publicitaria). Para
 * operaciones que actúan sobre un nodo concreto por id (insights de una
 * campaña, ads/adsets de una campaña, leads, update de campaña): no
 * necesitan el Ad Account, así que no deben fallar aunque el token tenga
 * varias cuentas.
 */
async function resolveMetaToken(workspaceId: string, adhoc?: Record<string, string>): Promise<string> {
  if (adhoc?.META_ADS_TOKEN) return adhoc.META_ADS_TOKEN;
  const conn = await pickMetaConnection(workspaceId);
  if (conn && !(conn.expiresAt && conn.expiresAt < new Date())) {
    const t = decryptSecret(conn.accessTokenEnc);
    if (t) return t;
  }
  // Fallback: token permanente guardado como ad-hoc (System User).
  const stored = await loadStoredAdhocCredentials(workspaceId);
  if (stored.META_ADS_TOKEN) return stored.META_ADS_TOKEN;
  throw new Error("No hay token de Meta configurado — pega tu Access Token en /campanas-meta (Conexión Meta)");
}

/**
 * Resuelve una cuenta publicitaria por nombre (fuzzy) o por id (act_xxx /
 * xxx). Devuelve el id en formato "act_xxx" o null si no encuentra una.
 */
export async function metaAdsResolveAccount(
  workspaceId: string,
  query: string
): Promise<{ id: string; name: string } | null> {
  const accounts = await metaAdsListAdAccounts(workspaceId);
  const q = query.trim().toLowerCase();
  const norm = (s: string) => s.toLowerCase().replace(/^act_/, "");
  let hit =
    accounts.find((a: any) => norm(a.id) === norm(q)) ??
    accounts.find((a: any) => (a.name ?? "").toLowerCase() === q) ??
    accounts.find((a: any) => (a.name ?? "").toLowerCase().includes(q));
  return hit ? { id: hit.id, name: hit.name } : null;
}

/**
 * Lista las campañas de TODAS las cuentas publicitarias del token,
 * agrupadas por cuenta. Para "dime todas las campañas". Cada cuenta es
 * una llamada; los errores por cuenta se devuelven sin abortar el resto.
 */
export async function metaAdsListAllCampaigns(opts: {
  workspaceId: string;
  status?: "ACTIVE" | "PAUSED" | "ARCHIVED";
  perAccountLimit?: number;
}): Promise<Array<{ account: { id: string; name: string }; campaigns?: any[]; error?: string }>> {
  const accounts = await metaAdsListAdAccounts(opts.workspaceId);
  const out: Array<{ account: { id: string; name: string }; campaigns?: any[]; error?: string }> = [];
  for (const acc of accounts) {
    try {
      const campaigns = await metaAdsListCampaigns({
        workspaceId: opts.workspaceId,
        status: opts.status,
        limit: opts.perAccountLimit ?? 50,
        adhoc: { META_ADS_AD_ACCOUNT_ID: acc.id }
      });
      out.push({ account: { id: acc.id, name: acc.name }, campaigns });
    } catch (e: any) {
      out.push({ account: { id: acc.id, name: acc.name }, error: String(e?.message ?? e) });
    }
  }
  return out;
}

/**
 * Decide si un error de Meta Ads es transient y vale reintentar.
 * Reintentamos SOLO: 5xx y errores de red.
 * NO reintentamos rate-limits (429, code 4/17/613/80xxx): reintentar
 * rápido AGRAVA el bloqueo. Esos los gestiona el guardián (cooldown).
 */
function isTransientMeta(status: number, _body: string): boolean {
  return status >= 500;
}

const RETRY_DELAYS_MS = [1000, 3000, 8000]; // 3 reintentos, ~12s total max

async function metaFetch<T = any>(url: string, accessToken: string): Promise<T> {
  const u = url.includes("?")
    ? `${url}&access_token=${encodeURIComponent(accessToken)}`
    : `${url}?access_token=${encodeURIComponent(accessToken)}`;
  let lastErr = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      noteMetaUsage(r.headers);
      if (!r.ok) {
        const t = await r.text();
        noteMetaErrorBody(r.status, t);
        lastErr = `Meta Ads ${r.status}: ${t.slice(0, 200)}`;
        if (attempt < RETRY_DELAYS_MS.length && isTransientMeta(r.status, t)) {
          await new Promise((res) => setTimeout(res, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        throw new Error(lastErr);
      }
      return r.json();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // Errores de red (fetch failed, ECONNRESET, etc.) son transient
      if (attempt < RETRY_DELAYS_MS.length && /fetch failed|ECONNRESET|ETIMEDOUT|socket hang/i.test(msg)) {
        lastErr = msg;
        await new Promise((res) => setTimeout(res, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw e;
    }
  }
  throw new Error(lastErr || "metaFetch: agotados los reintentos");
}

export async function metaAdsListAdAccounts(workspaceId: string, adhoc?: Record<string, string>) {
  let token: string | null = adhoc?.META_ADS_TOKEN ?? null;
  if (!token) {
    const conn = await pickMetaConnection(workspaceId);
    if (!conn) throw new Error("MetaConnection no configurada");
    token = decryptSecret(conn.accessTokenEnc);
    if (!token) throw new Error("token inválido");
  }
  // Paginamos TODAS las cuentas (Graph devuelve 25 por página por defecto;
  // sin paginar, cuentas como EUROSISTEMAS quedaban fuera y "no se veían").
  const out: Array<{ id: string; name: string; status: any; currency: any; timezone: any }> = [];
  let after = "";
  for (let i = 0; i < 20; i++) {
    const url =
      `${GRAPH}/me/adaccounts?fields=id,name,account_status,currency,timezone_name&limit=200` +
      (after ? `&after=${encodeURIComponent(after)}` : "");
    const data = await metaFetch<any>(url, token);
    for (const a of data.data ?? []) {
      out.push({
        id: a.id, // formato "act_xxx"
        name: a.name,
        status: a.account_status,
        currency: a.currency,
        timezone: a.timezone_name
      });
    }
    after = data.paging?.cursors?.after ?? "";
    if (!after || !(data.data?.length)) break;
  }
  return out;
}

export async function metaAdsListCampaigns(opts: {
  workspaceId: string;
  status?: "ACTIVE" | "PAUSED" | "ARCHIVED";
  statusField?: "effective_status" | "configured_status" | "status";
  limit?: number;
  adhoc?: Record<string, string>;
}) {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const account = cfg.adAccountId.startsWith("act_") ? cfg.adAccountId : `act_${cfg.adAccountId}`;
  const params = new URLSearchParams({
    fields: "id,name,status,configured_status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,buying_type",
    limit: String(opts.limit ?? 50)
  });
  if (opts.status) {
    params.set("filtering", JSON.stringify([{ field: opts.statusField ?? "effective_status", operator: "IN", value: [opts.status] }]));
  }
  const data = await metaFetch<any>(
    `${GRAPH_CAMPAIGN_STATUS}/${account}/campaigns?${params.toString()}`,
    cfg.accessToken
  );
  const campaigns = data.data ?? [];
  // The account campaigns edge already returns current status fields. A
  // second request per campaign exhausts Meta's request budget on accounts
  // with a long campaign history (error 17).
  return campaigns;
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
  const accessToken = await resolveMetaToken(opts.workspaceId, opts.adhoc);
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
    accessToken
  );
  // Devolvemos solo el primer "rollup" del rango — Meta puede partir
  // por dimensiones que no estamos pidiendo aquí.
  return (data.data ?? [])[0] ?? null;
}

/** Account-level totals for reconciliation with Ads Manager, including campaigns paused today. */
export async function metaAdsGetAccountInsights(opts: {
  workspaceId: string;
  since: string;
  until: string;
  adhoc?: Record<string, string>;
}) {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const account = cfg.adAccountId.startsWith("act_") ? cfg.adAccountId : `act_${cfg.adAccountId}`;
  const params = new URLSearchParams({
    fields: "spend,impressions,clicks,reach",
    level: "account",
    time_range: JSON.stringify({ since: opts.since, until: opts.until })
  });
  const data = await metaFetch<any>(`${GRAPH}/${account}/insights?${params.toString()}`, cfg.accessToken);
  return (data.data ?? [])[0] ?? { spend: "0", impressions: "0", clicks: "0", reach: "0" };
}

/**
 * Insights DIARIOS de una campaña (time_increment=1) en los últimos N días.
 * Devuelve un array con { date, spend, leads } por día — para detectar
 * pacing/entrega parada y caídas de leads sin hacer dos llamadas por
 * periodo. `leads` suma cualquier action_type que contenga "lead".
 */
export async function metaAdsGetCampaignDailyInsights(opts: {
  workspaceId: string;
  campaignId: string;
  days?: number;
  since?: string;
  until?: string;
  resultActionTypes?: string[];
  adhoc?: Record<string, string>;
}): Promise<Array<{ date: string; spend: number; leads: number }>> {
  const accessToken = await resolveMetaToken(opts.workspaceId, opts.adhoc);
  const days = Math.min(Math.max(opts.days ?? 14, 2), 90);
  const params = new URLSearchParams({ fields: "spend,actions,date_start", time_increment: "1" });
  if (opts.since && opts.until) params.set("time_range", JSON.stringify({ since: opts.since, until: opts.until }));
  else params.set("date_preset", days <= 7 ? "last_7d" : days <= 14 ? "last_14d" : days <= 30 ? "last_30d" : "last_90d");
  const data = await metaFetch<any>(
    `${GRAPH}/${opts.campaignId}/insights?${params.toString()}`,
    accessToken
  );
  return (data.data ?? []).map((row: any) => {
    const leads = Array.isArray(row.actions)
      ? (opts.resultActionTypes ?? ["lead"])
          .map((type) => row.actions.find((a: any) => String(a.action_type ?? "").toLowerCase() === type.toLowerCase()))
          .filter(Boolean)
          .map((action: any) => Number(action.value ?? 0))[0] ?? 0
      : 0;
    return { date: String(row.date_start ?? ""), spend: Number(row.spend ?? 0), leads };
  });
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
  const accessToken = await resolveMetaToken(opts.workspaceId, opts.adhoc);
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
    accessToken
  );
  return data.data ?? [];
}

/**
 * Lista los adsets de una campaña. Necesario para descender en el
 * arbol campaign → adsets → ads cuando no conoces los ids previos.
 */
export async function metaAdsListAdsets(opts: {
  workspaceId: string;
  campaignId: string;
  adhoc?: Record<string, string>;
  limit?: number;
}) {
  const accessToken = await resolveMetaToken(opts.workspaceId, opts.adhoc);
  const params = new URLSearchParams({
    fields:
      "id,name,status,campaign_id,daily_budget,optimization_goal,destination_type,promoted_object,targeting",
    limit: String(opts.limit ?? 50)
  });
  const data = await metaFetch<any>(
    `${GRAPH}/${opts.campaignId}/adsets?${params.toString()}`,
    accessToken
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
  const accessToken = await resolveMetaToken(opts.workspaceId, opts.adhoc);

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
      const resp: any = await metaFetch(url, accessToken);
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

// ============================================================================
// META MARKETING API — WRITE OPERATIONS
// ============================================================================
//
// Todas las funciones de creación van con status="PAUSED" por DEFAULT.
// El humano (admin) debe revisar manualmente y activar en Ads Manager
// — esto es deliberado: una IA creando campañas que gastan dinero del
// cliente sin aprobación humana es zona prohibida. La macro
// metaAdsCreateLeadCampaign DEVUELVE la URL de Ads Manager para review.
//
// Conversión de presupuesto: Meta API quiere cantidades en la SUBUNIDAD
// de la moneda (céntimos para EUR). 15€/día → daily_budget=1500.

/** Helper POST contra Graph API. Acepta payload JSON, devuelve JSON.
 *  Auto-retry en errores transient (5xx / 429 / network) con backoff
 *  exponencial. No reintenta 4xx (validation/auth) — son fallos lógicos. */
async function metaPost<T = any>(
  path: string,
  accessToken: string,
  payload: Record<string, unknown>
): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  body.set("access_token", accessToken);
  let lastErr = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    // Verja anti-bloqueo: serializa + espacia escrituras y corta si Meta
    // está en enfriamiento (lanza MetaCooldownError, que no reintentamos).
    await metaWriteGate();
    try {
      const r = await fetch(`${GRAPH}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      });
      noteMetaUsage(r.headers);
      if (!r.ok) {
        const t = await r.text();
        noteMetaErrorBody(r.status, t);
        lastErr = `Meta Ads POST ${path} ${r.status}: ${t.slice(0, 400)}`;
        if (attempt < RETRY_DELAYS_MS.length && isTransientMeta(r.status, t)) {
          await new Promise((res) => setTimeout(res, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        throw new Error(lastErr);
      }
      return r.json();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (attempt < RETRY_DELAYS_MS.length && /fetch failed|ECONNRESET|ETIMEDOUT|socket hang/i.test(msg)) {
        lastErr = msg;
        await new Promise((res) => setTimeout(res, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw e;
    }
  }
  throw new Error(lastErr || "metaPost: agotados los reintentos");
}

function eurosToCentavos(eur: number): number {
  return Math.round(eur * 100);
}

/**
 * Update masivo: aplica el mismo cambio (status, etc.) a N campañas
 * en paralelo. Caso de uso típico: limpiar 5 campañas duplicadas en
 * un solo step en lugar de llamar update 5 veces.
 *
 * Devuelve un array con el resultado por campaignId (ok / error).
 * NO aborta si una falla — las demás se siguen procesando.
 */
export async function metaAdsBulkUpdateCampaigns(opts: {
  workspaceId: string;
  campaignIds: string[];
  status?: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  dailyBudgetEur?: number;
  adhoc?: Record<string, string>;
}): Promise<Array<{ campaignId: string; ok: boolean; error?: string }>> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const results = await Promise.allSettled(
    opts.campaignIds.map(async (id) => {
      const payload: Record<string, unknown> = {};
      if (opts.status) payload.status = opts.status;
      if (typeof opts.dailyBudgetEur === "number") {
        payload.daily_budget = eurosToCentavos(opts.dailyBudgetEur);
      }
      if (Object.keys(payload).length === 0) {
        throw new Error("Pasa al menos un campo (status / dailyBudgetEur)");
      }
      await metaPost(`/${id}`, cfg.accessToken, payload);
      return id;
    })
  );
  return opts.campaignIds.map((id, i) => {
    const r = results[i];
    if (r.status === "fulfilled") return { campaignId: id, ok: true };
    return { campaignId: id, ok: false, error: String((r.reason as Error)?.message ?? r.reason).slice(0, 200) };
  });
}

function adAccountPath(adAccountId: string): string {
  return adAccountId.startsWith("act_") ? `/${adAccountId}` : `/act_${adAccountId}`;
}

// ─── Páginas de Facebook (necesarias para Lead Ads) ─────────────

/**
 * Lista las páginas de Facebook que el usuario del token puede
 * usar para lanzar Lead Ads. Cada Lead Form va asociado a una
 * página, y los anuncios también.
 *
 * Devuelve también el page access token de cada una — pero NO lo
 * devolvemos en la respuesta para no filtrarlo al modelo. El que
 * llama desde server-side lo usa internamente.
 */
export async function metaAdsListPages(opts: {
  workspaceId: string;
  adhoc?: Record<string, string>;
}): Promise<Array<{ id: string; name: string; category?: string }>> {
  // Reusa el token (usuario) — el endpoint /me/accounts devuelve
  // las pages del user con su page_access_token (lo necesitamos
  // internamente para crear leadgen_forms).
  let token = opts.adhoc?.META_ADS_TOKEN ?? null;
  if (!token) {
    const conn = await prisma.metaConnection.findFirst({
      where: { workspaceId: opts.workspaceId }
    });
    if (!conn) throw new Error("MetaConnection no configurada");
    token = decryptSecret(conn.accessTokenEnc);
    if (!token) throw new Error("token inválido");
  }
  const data = await metaFetch<any>(
    `${GRAPH}/me/accounts?fields=id,name,category,access_token&limit=100`,
    token
  );
  return (data.data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    category: p.category
    // OJO: NO exponemos access_token al modelo. Se obtiene
    // internamente cuando se necesita.
  }));
}

/** Resuelve el page_access_token de una página concreta. Server-side only. */
async function getPageAccessToken(
  workspaceId: string,
  pageId: string,
  adhoc?: Record<string, string>
): Promise<string> {
  let token = adhoc?.META_ADS_TOKEN ?? null;
  if (!token) {
    const conn = await prisma.metaConnection.findFirst({ where: { workspaceId } });
    if (!conn) throw new Error("MetaConnection no configurada");
    token = decryptSecret(conn.accessTokenEnc);
    if (!token) throw new Error("token inválido");
  }
  const data = await metaFetch<any>(`${GRAPH}/${pageId}?fields=access_token`, token);
  if (!data?.access_token) {
    throw new Error(
      `No se pudo obtener page_access_token para page=${pageId}. El user del token debe tener rol en esa página.`
    );
  }
  return data.access_token;
}

// ─── Campañas ────────────────────────────────────────────────────

/**
 * Crea una campaña en PAUSED por defecto. El humano la activa en
 * Ads Manager tras revisar.
 *
 * objective common: OUTCOME_LEADS, OUTCOME_TRAFFIC, OUTCOME_SALES,
 * OUTCOME_AWARENESS, OUTCOME_ENGAGEMENT, OUTCOME_APP_PROMOTION.
 */
export async function metaAdsCreateCampaign(opts: {
  workspaceId: string;
  name: string;
  objective: string;
  dailyBudgetEur?: number;
  lifetimeBudgetEur?: number;
  status?: "PAUSED" | "ACTIVE";
  adhoc?: Record<string, string>;
}): Promise<{ id: string; name: string }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const payload: Record<string, unknown> = {
    name: opts.name,
    objective: opts.objective,
    status: opts.status ?? "PAUSED",
    special_ad_categories: "[]", // requerido por la API aunque sea vacío
    // Forzamos bid_strategy a nivel campaña para evitar herencia de la
    // cuenta. LOWEST_COST_WITHOUT_CAP es el modo "auto" sin techo de
    // puja — no requiere bid_amount en el adset.
    bid_strategy: "LOWEST_COST_WITHOUT_CAP"
  };
  if (opts.dailyBudgetEur) payload.daily_budget = eurosToCentavos(opts.dailyBudgetEur);
  if (opts.lifetimeBudgetEur) payload.lifetime_budget = eurosToCentavos(opts.lifetimeBudgetEur);
  const data = await metaPost<{ id: string }>(
    `${adAccountPath(cfg.adAccountId)}/campaigns`,
    cfg.accessToken,
    payload
  );
  return { id: data.id, name: opts.name };
}

/**
 * Devuelve false si la campaña está borrada/archivada o no es accesible.
 * Lo usa el dedupe por task_id para no devolver una campaña DELETED (Meta no
 * deja añadir adsets a campañas borradas → la task se quedaba atascada).
 */
export async function metaAdsCampaignUsable(opts: {
  workspaceId: string;
  campaignId: string;
  adhoc?: Record<string, string>;
}): Promise<boolean> {
  try {
    const token = await resolveMetaToken(opts.workspaceId, opts.adhoc);
    const data = await metaFetch<any>(
      `${GRAPH}/${opts.campaignId}?fields=configured_status,effective_status`,
      token
    );
    const st = String(data?.configured_status ?? data?.effective_status ?? "");
    return st !== "DELETED" && st !== "ARCHIVED";
  } catch {
    return false;
  }
}

export async function metaAdsUpdateCampaign(opts: {
  workspaceId: string;
  campaignId: string;
  name?: string;
  status?: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  dailyBudgetEur?: number;
  lifetimeBudgetEur?: number;
  adhoc?: Record<string, string>;
}): Promise<{ success: boolean }> {
  const accessToken = await resolveMetaToken(opts.workspaceId, opts.adhoc);
  const payload: Record<string, unknown> = {};
  if (opts.name) payload.name = opts.name;
  if (opts.status) payload.status = opts.status;
  if (opts.dailyBudgetEur) payload.daily_budget = eurosToCentavos(opts.dailyBudgetEur);
  if (opts.lifetimeBudgetEur) payload.lifetime_budget = eurosToCentavos(opts.lifetimeBudgetEur);
  if (Object.keys(payload).length === 0) {
    throw new Error("Pasa al menos un campo a actualizar (name, status, daily/lifetimeBudgetEur)");
  }
  await metaPost(`/${opts.campaignId}`, accessToken, payload);
  return { success: true };
}

// ─── Adsets ──────────────────────────────────────────────────────

/**
 * Crea un adset. Para Lead Ads el optimization_goal típico es
 * LEAD_GENERATION + destination_type=ON_AD (formulario instantáneo).
 *
 * Targeting mínimo: { geo_locations: { countries: ['ES'] } }.
 */
export async function metaAdsCreateAdset(opts: {
  workspaceId: string;
  campaignId: string;
  name: string;
  dailyBudgetEur?: number;
  /** Targeting objeto Meta. Mínimo: { geo_locations: { countries: ['ES'] } }. */
  targeting: Record<string, unknown>;
  optimizationGoal?: string;
  billingEvent?: string;
  destinationType?: string;
  /** ISO 8601. Default: ahora. */
  startTime?: string;
  endTime?: string;
  status?: "PAUSED" | "ACTIVE";
  /** Bid strategy. Default LOWEST_COST_WITHOUT_CAP (no requiere
   *  bid_amount). Si pones COST_CAP o LOWEST_COST_WITH_BID_CAP,
   *  DEBES pasar bidAmountCents o Meta devuelve 400 error_subcode
   *  2490487 ("Se requiere un importe de puja"). */
  bidStrategy?:
    | "LOWEST_COST_WITHOUT_CAP"
    | "LOWEST_COST_WITH_BID_CAP"
    | "COST_CAP"
    | "LOWEST_COST_WITH_MIN_ROAS";
  /** Bid cap en centavos. Requerido si bidStrategy !== LOWEST_COST_WITHOUT_CAP. */
  bidAmountCents?: number;
  /** REQUERIDO para Lead Ads con destinationType=ON_AD: Meta exige
   *  promoted_object = { page_id } para que sepa qué Page recibe los
   *  leads. Sin esto la API devuelve 400 (Sonia identificó este bug
   *  el 19 may). Para otros casos (app installs, conversion events)
   *  puede llevar applicationId/customEventType. */
  promotedObject?: {
    pageId?: string;
    applicationId?: string;
    customEventType?: string;
    customEventStr?: string;
    productSetId?: string;
    pixelId?: string;
  };
  adhoc?: Record<string, string>;
}): Promise<{ id: string; name: string }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const bidStrategy = opts.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP";
  const payload: Record<string, unknown> = {
    name: opts.name,
    campaign_id: opts.campaignId,
    optimization_goal: opts.optimizationGoal ?? "LEAD_GENERATION",
    billing_event: opts.billingEvent ?? "IMPRESSIONS",
    destination_type: opts.destinationType ?? "ON_AD",
    targeting: opts.targeting,
    status: opts.status ?? "PAUSED",
    start_time: opts.startTime ?? new Date(Date.now() + 60_000).toISOString(),
    bid_strategy: bidStrategy
  };
  if (opts.dailyBudgetEur) payload.daily_budget = eurosToCentavos(opts.dailyBudgetEur);
  if (opts.endTime) payload.end_time = opts.endTime;
  if (
    opts.bidAmountCents &&
    bidStrategy !== "LOWEST_COST_WITHOUT_CAP"
  ) {
    payload.bid_amount = opts.bidAmountCents;
  }
  // promoted_object: Meta exige page_id para Lead Ads on-ad.
  // El field es top-level del payload, NO anidado en targeting.
  if (opts.promotedObject) {
    const po: Record<string, string> = {};
    if (opts.promotedObject.pageId) po.page_id = opts.promotedObject.pageId;
    if (opts.promotedObject.applicationId) po.application_id = opts.promotedObject.applicationId;
    if (opts.promotedObject.customEventType) po.custom_event_type = opts.promotedObject.customEventType;
    if (opts.promotedObject.customEventStr) po.custom_event_str = opts.promotedObject.customEventStr;
    if (opts.promotedObject.productSetId) po.product_set_id = opts.promotedObject.productSetId;
    if (opts.promotedObject.pixelId) po.pixel_id = opts.promotedObject.pixelId;
    if (Object.keys(po).length > 0) {
      payload.promoted_object = po;
    }
  }
  const data = await metaPost<{ id: string }>(
    `${adAccountPath(cfg.adAccountId)}/adsets`,
    cfg.accessToken,
    payload
  );
  return { id: data.id, name: opts.name };
}

export async function metaAdsUpdateAdset(opts: {
  workspaceId: string;
  adsetId: string;
  name?: string;
  status?: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  dailyBudgetEur?: number;
  targeting?: Record<string, unknown>;
  adhoc?: Record<string, string>;
}): Promise<{ success: boolean }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const payload: Record<string, unknown> = {};
  if (opts.name) payload.name = opts.name;
  if (opts.status) payload.status = opts.status;
  if (opts.dailyBudgetEur) payload.daily_budget = eurosToCentavos(opts.dailyBudgetEur);
  if (opts.targeting) payload.targeting = opts.targeting;
  if (Object.keys(payload).length === 0) throw new Error("Pasa al menos un campo");
  await metaPost(`/${opts.adsetId}`, cfg.accessToken, payload);
  return { success: true };
}

// ─── Lead Forms ──────────────────────────────────────────────────

/**
 * Crea un formulario de Lead Ads en una página. Los formularios
 * de Meta requieren OBLIGATORIAMENTE:
 *   - privacy_policy.url (link a política de privacidad del cliente)
 *   - questions[] con tipos válidos
 *
 * Tipos de pregunta soportados (subset común):
 *   - FULL_NAME, EMAIL, PHONE_NUMBER, CITY, STATE, ZIP_CODE,
 *     COUNTRY, COMPANY_NAME, JOB_TITLE, MARITAL_STATUS, RELATIONSHIP_STATUS
 *   - CUSTOM con type=SHORT_ANSWER, MULTIPLE_CHOICE, CONDITIONAL
 *
 * Pregunta CUSTOM con opciones:
 *   { type: "CUSTOM", key: "tipo_despido", label: "¿Qué tipo de despido?",
 *     options: [{ key: "disciplinario", value: "Disciplinario" }, ...] }
 */
export async function metaAdsCreateLeadForm(opts: {
  workspaceId: string;
  pageId: string;
  name: string;
  questions: Array<{
    type: string;
    key?: string;
    label?: string;
    options?: Array<{ key: string; value: string }>;
  }>;
  privacyPolicyUrl: string;
  privacyPolicyLinkText?: string;
  followUpActionUrl?: string;
  /** Locale del form: "es_ES" para España. */
  locale?: string;
  adhoc?: Record<string, string>;
}): Promise<{ id: string; name: string }> {
  const pageToken = await getPageAccessToken(opts.workspaceId, opts.pageId, opts.adhoc);
  const payload: Record<string, unknown> = {
    name: opts.name,
    questions: opts.questions,
    privacy_policy: {
      url: opts.privacyPolicyUrl,
      link_text: opts.privacyPolicyLinkText ?? "Política de privacidad"
    },
    locale: opts.locale ?? "es_ES"
  };
  if (opts.followUpActionUrl) payload.follow_up_action_url = opts.followUpActionUrl;
  const data = await metaPost<{ id: string }>(
    `/${opts.pageId}/leadgen_forms`,
    pageToken,
    payload
  );
  return { id: data.id, name: opts.name };
}

export async function metaAdsListLeadForms(opts: {
  workspaceId: string;
  pageId: string;
  adhoc?: Record<string, string>;
}): Promise<Array<{ id: string; name: string; status: string; created_time: string }>> {
  const pageToken = await getPageAccessToken(opts.workspaceId, opts.pageId, opts.adhoc);
  const data = await metaFetch<any>(
    `${GRAPH}/${opts.pageId}/leadgen_forms?fields=id,name,status,created_time&limit=100`,
    pageToken
  );
  return data.data ?? [];
}

// ─── Imágenes / Creatives ────────────────────────────────────────

/**
 * Sube una imagen a la ad account y devuelve el image_hash que se
 * usa para construir creativos.
 *
 * Recibe el File ID local (un adjunto subido a R2) — descarga el
 * binario y lo envía a Meta como multipart.
 */
export async function metaAdsUploadImage(opts: {
  workspaceId: string;
  fileId?: string;
  /** Alternativa al fileId: URL pública/firmada (p.ej. de R2) — se descarga
   *  en el servidor y se sube a Meta. Útil para imágenes de campos de
   *  formulario que llegan como URL. */
  url?: string;
  adhoc?: Record<string, string>;
}): Promise<{ hash: string; url: string }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  let buf: Buffer;
  let fileName = "image.jpg";
  let mimeType = "image/jpeg";
  if (opts.fileId) {
    const file = await prisma.file.findFirst({
      where: { id: opts.fileId, workspaceId: opts.workspaceId }
    });
    if (!file) throw new Error(`File ${opts.fileId} no encontrado en el workspace`);
    const { downloadBuffer } = await import("@/lib/storage/r2");
    buf = await downloadBuffer(file.s3Key);
    fileName = file.name;
    mimeType = file.mimeType;
  } else if (opts.url) {
    const r0 = await fetch(opts.url, { signal: AbortSignal.timeout(30000) });
    if (!r0.ok) throw new Error(`No se pudo descargar la imagen (${r0.status}) de ${opts.url.slice(0, 80)}`);
    buf = Buffer.from(await r0.arrayBuffer());
    mimeType = r0.headers.get("content-type") || "image/jpeg";
    const m = /\/([^/?#]+\.(?:jpg|jpeg|png|webp|gif))/i.exec(opts.url);
    if (m) fileName = m[1];
  } else {
    throw new Error("metaAdsUploadImage: falta fileId o url");
  }

  // Multipart upload a /act_X/adimages.
  const form = new FormData();
  const blob = new Blob([buf as any], { type: mimeType });
  form.append("file", blob, fileName);
  form.append("access_token", cfg.accessToken);
  await metaWriteGate();
  const r = await fetch(`${GRAPH}${adAccountPath(cfg.adAccountId)}/adimages`, {
    method: "POST",
    body: form as any
  });
  noteMetaUsage(r.headers);
  if (!r.ok) {
    const t = await r.text();
    noteMetaErrorBody(r.status, t);
    throw new Error(`Meta Ads upload image ${r.status}: ${t.slice(0, 400)}`);
  }
  const data: any = await r.json();
  // Response shape: { images: { "filename.jpg": { hash, url } } }
  const first = data.images && Object.values(data.images)[0];
  if (!first || typeof first !== "object") {
    throw new Error("Respuesta de adimages sin hash");
  }
  return { hash: (first as any).hash, url: (first as any).url };
}

/**
 * Crea un ad creative para Lead Ads:
 *   - Asociado a una page (pageId)
 *   - Link al lead form (lead_gen_form_id)
 *   - Imagen única (single image)
 *
 * Para video / carousel: extender más adelante.
 */
export async function metaAdsCreateAdCreative(opts: {
  workspaceId: string;
  name: string;
  pageId: string;
  leadFormId: string;
  imageHash: string;
  /** Texto principal (encima del anuncio) */
  primaryText: string;
  /** Headline (debajo de la imagen, ~25-40 chars). */
  headline?: string;
  /** Descripción opcional. */
  description?: string;
  /** Call to action: LEARN_MORE, CONTACT_US, SIGN_UP, GET_QUOTE, etc. */
  callToAction?: string;
  /**
   * URL del enlace del creativo. Para Lead Ads on-ad NO se navega
   * (el form se abre en la propia red), pero Meta exige una URL
   * válida HTTPS aquí o el creativo se rechaza con subcode 2446433.
   * Pasa la URL de privacidad del cliente o la home del cliente.
   */
  link?: string;
  adhoc?: Record<string, string>;
}): Promise<{ id: string }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  // Bug histórico: usar "https://fb.me/leadgen" como link fantasma
  // dispara error 2446433 "Tipo de contenido compartido no válido para
  // el enlace de llamada a la acción" en cuentas con validación
  // estricta. Meta exige (a) link top-level válido HTTPS y (b) link
  // duplicado dentro de call_to_action.value.link junto a lead_gen_form_id.
  // Si el caller no pasa link, usamos la página oficial de Facebook
  // del cliente (https://facebook.com/<pageId>) que siempre es válida.
  const safeLink = opts.link && /^https:\/\//i.test(opts.link)
    ? opts.link
    : `https://www.facebook.com/${opts.pageId}`;
  const objectStorySpec = {
    page_id: opts.pageId,
    link_data: {
      image_hash: opts.imageHash,
      message: opts.primaryText,
      name: opts.headline ?? undefined,
      description: opts.description ?? undefined,
      link: safeLink,
      call_to_action: {
        type: opts.callToAction ?? "SIGN_UP",
        value: {
          lead_gen_form_id: opts.leadFormId,
          link: safeLink
        }
      }
    }
  };
  const data = await metaPost<{ id: string }>(
    `${adAccountPath(cfg.adAccountId)}/adcreatives`,
    cfg.accessToken,
    {
      name: opts.name,
      object_story_spec: objectStorySpec
    }
  );
  return { id: data.id };
}

/** Descarga bytes desde un File (R2) o una URL, en el servidor. */
async function loadMediaBytes(opts: {
  workspaceId: string;
  fileId?: string;
  url?: string;
}): Promise<{ buf: Buffer; fileName: string; mimeType: string }> {
  if (opts.fileId) {
    const file = await prisma.file.findFirst({
      where: { id: opts.fileId, workspaceId: opts.workspaceId }
    });
    if (!file) throw new Error(`File ${opts.fileId} no encontrado en el workspace`);
    const { downloadBuffer } = await import("@/lib/storage/r2");
    return { buf: await downloadBuffer(file.s3Key), fileName: file.name, mimeType: file.mimeType };
  }
  if (opts.url) {
    const r0 = await fetch(opts.url, { signal: AbortSignal.timeout(60000) });
    if (!r0.ok) throw new Error(`No se pudo descargar (${r0.status}) de ${opts.url.slice(0, 80)}`);
    const mimeType = r0.headers.get("content-type") || "application/octet-stream";
    const m = /\/([^/?#]+\.[a-z0-9]{2,5})(?:[?#]|$)/i.exec(opts.url);
    return { buf: Buffer.from(await r0.arrayBuffer()), fileName: m ? m[1] : "media", mimeType };
  }
  throw new Error("Falta fileId o url");
}

/**
 * Sube un VÍDEO a la ad account (/advideos) y espera a que Meta lo procese.
 * Devuelve el videoId listo para usar en un creative de vídeo.
 */
export async function metaAdsUploadVideo(opts: {
  workspaceId: string;
  fileId?: string;
  url?: string;
  adhoc?: Record<string, string>;
}): Promise<{ videoId: string }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const { buf, fileName, mimeType } = await loadMediaBytes(opts);
  const form = new FormData();
  form.append("source", new Blob([buf as any], { type: mimeType || "video/mp4" }), fileName || "video.mp4");
  form.append("access_token", cfg.accessToken);
  await metaWriteGate();
  const r = await fetch(`${GRAPH}${adAccountPath(cfg.adAccountId)}/advideos`, {
    method: "POST",
    body: form as any
  });
  noteMetaUsage(r.headers);
  if (!r.ok) {
    const t = await r.text();
    noteMetaErrorBody(r.status, t);
    throw new Error(`Meta Ads upload video ${r.status}: ${t.slice(0, 400)}`);
  }
  const data: any = await r.json();
  const videoId = String(data.id ?? "");
  if (!videoId) throw new Error("Respuesta de advideos sin id");

  // El vídeo se procesa en asíncrono — esperamos hasta ~90s a que esté listo.
  for (let i = 0; i < 18; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    try {
      const st: any = await metaFetch(
        `${GRAPH}/${videoId}?fields=status`,
        cfg.accessToken
      );
      const phase = st?.status?.video_status;
      if (phase === "ready") return { videoId };
      if (phase === "error") throw new Error("Meta no pudo procesar el vídeo (status=error).");
    } catch {
      /* reintenta */
    }
  }
  // Aunque no confirmemos "ready", devolvemos el id (Meta suele terminar
  // poco después; el creative puede crearse y quedará pendiente).
  return { videoId };
}

/**
 * Crea un ad creative de CARRUSEL para Lead Ads (varias tarjetas).
 * imageHashes: 2-10 hashes (de meta_ads_upload_image). cards opcional para
 * personalizar título/descr por tarjeta.
 */
export async function metaAdsCreateCarouselCreative(opts: {
  workspaceId: string;
  name: string;
  pageId: string;
  leadFormId: string;
  imageHashes: string[];
  primaryText: string;
  cards?: { name?: string; description?: string }[];
  callToAction?: string;
  link?: string;
  adhoc?: Record<string, string>;
}): Promise<{ id: string }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const hashes = (opts.imageHashes ?? []).filter(Boolean).slice(0, 10);
  if (hashes.length < 2) throw new Error("Un carrusel necesita al menos 2 imágenes (image_hash).");
  const safeLink = opts.link && /^https:\/\//i.test(opts.link) ? opts.link : `https://www.facebook.com/${opts.pageId}`;
  const cta = {
    type: opts.callToAction ?? "SIGN_UP",
    value: { lead_gen_form_id: opts.leadFormId, link: safeLink }
  };
  const child_attachments = hashes.map((h, i) => ({
    image_hash: h,
    link: safeLink,
    name: opts.cards?.[i]?.name ?? undefined,
    description: opts.cards?.[i]?.description ?? undefined,
    call_to_action: cta
  }));
  const objectStorySpec = {
    page_id: opts.pageId,
    link_data: {
      message: opts.primaryText,
      link: safeLink,
      child_attachments,
      multi_share_optimized: true,
      call_to_action: cta
    }
  };
  const data = await metaPost<{ id: string }>(
    `${adAccountPath(cfg.adAccountId)}/adcreatives`,
    cfg.accessToken,
    { name: opts.name, object_story_spec: objectStorySpec }
  );
  return { id: data.id };
}

/**
 * Crea un ad creative de VÍDEO para Lead Ads. Requiere videoId (de
 * metaAdsUploadVideo) y un imageHash de miniatura (de meta_ads_upload_image).
 */
export async function metaAdsCreateVideoCreative(opts: {
  workspaceId: string;
  name: string;
  pageId: string;
  leadFormId: string;
  videoId: string;
  thumbnailImageHash: string;
  primaryText: string;
  headline?: string;
  description?: string;
  callToAction?: string;
  link?: string;
  adhoc?: Record<string, string>;
}): Promise<{ id: string }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const safeLink = opts.link && /^https:\/\//i.test(opts.link) ? opts.link : `https://www.facebook.com/${opts.pageId}`;
  const objectStorySpec = {
    page_id: opts.pageId,
    video_data: {
      video_id: opts.videoId,
      image_hash: opts.thumbnailImageHash,
      message: opts.primaryText,
      title: opts.headline ?? undefined,
      link_description: opts.description ?? undefined,
      call_to_action: {
        type: opts.callToAction ?? "SIGN_UP",
        value: { lead_gen_form_id: opts.leadFormId, link: safeLink }
      }
    }
  };
  const data = await metaPost<{ id: string }>(
    `${adAccountPath(cfg.adAccountId)}/adcreatives`,
    cfg.accessToken,
    { name: opts.name, object_story_spec: objectStorySpec }
  );
  return { id: data.id };
}

// ─── Custom Audiences (remarketing) ──────────────────────────────

/**
 * Crea una Custom Audience de ENGAGEMENT para remarketing, a partir de
 * interacciones con la Página de Facebook, el perfil de Instagram, un
 * formulario de leads o reproducciones de vídeo. Devuelve el audienceId
 * para usarlo en el targeting de un adset (custom_audiences:[{id}]).
 *
 * NOTA: el schema de `rule` de Meta para audiencias de engagement es
 * intrincado; cubrimos los casos habituales de remarketing. Si Meta cambia
 * el formato, ajustar el `rule` aquí.
 */
export async function metaAdsCreateCustomAudience(opts: {
  workspaceId: string;
  name: string;
  source: "page" | "instagram" | "lead_form" | "video";
  sourceId: string; // pageId | igBusinessId | leadFormId | videoId
  retentionDays?: number; // default 365
  adhoc?: Record<string, string>;
}): Promise<{ id: string }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const retention = Math.min(Math.max(opts.retentionDays ?? 365, 1), 365) * 24 * 3600;

  let eventSource: any;
  let filterValue: string;
  switch (opts.source) {
    case "page":
      eventSource = { type: "page", id: opts.sourceId };
      filterValue = "page_engaged";
      break;
    case "instagram":
      eventSource = { type: "ig_business", id: opts.sourceId };
      filterValue = "ig_business_profile_engaged";
      break;
    case "lead_form":
      eventSource = { type: "lead_gen_form", id: opts.sourceId };
      filterValue = "lead_generation_opened";
      break;
    case "video":
      eventSource = { type: "video", id: opts.sourceId };
      filterValue = "video_view";
      break;
    default:
      throw new Error(`source no soportado: ${opts.source}`);
  }

  // Regla con filtro de evento concreto (page_engaged, etc.). Es la forma
  // documentada, pero algunas cuentas/versiones rechazan el value con
  // (#2654) "Nombre de evento no válido". Por eso preparamos también un
  // fallback SIN filtro = "cualquier interacción" con esa fuente, que es
  // un superconjunto válido para remarketing.
  const ruleWithFilter = {
    inclusions: {
      operator: "or",
      rules: [
        {
          event_sources: [eventSource],
          retention_seconds: retention,
          filter: {
            operator: "and",
            filters: [{ field: "event", operator: "=", value: filterValue }]
          }
        }
      ]
    }
  };
  const ruleNoFilter = {
    inclusions: {
      operator: "or",
      rules: [{ event_sources: [eventSource], retention_seconds: retention }]
    }
  };

  const tryCreate = (rule: object) =>
    metaPost<{ id: string }>(`${adAccountPath(cfg.adAccountId)}/customaudiences`, cfg.accessToken, {
      name: opts.name,
      subtype: "ENGAGEMENT",
      rule: JSON.stringify(rule)
    });

  try {
    const data = await tryCreate(ruleWithFilter);
    return { id: data.id };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const isEventNameError = /2654|nombre de evento|invalid.*event|event.*invalid|engagement rule is invalid/i.test(msg);
    const isPermission = /permission on event source|audience creation permission/i.test(msg);
    if (isPermission) {
      throw new Error(
        `No hay permiso de creación de audiencias sobre la fuente (${opts.source} ${opts.sourceId}). ` +
          `El usuario/token debe tener rol de administrador con permiso de audiencias en esa Página/cuenta IG, ` +
          `o la cuenta es demasiado nueva (Meta lo habilita tras unas semanas). ` +
          `Crea el remarketing manualmente en Ads Manager o deja la campaña con el adset de frío. Detalle Meta: ${msg}`
      );
    }
    if (isEventNameError) {
      // Reintento con la regla amplia (sin filtro de evento).
      try {
        const data = await tryCreate(ruleNoFilter);
        return { id: data.id };
      } catch (e2: any) {
        throw new Error(
          `Meta rechazó la regla de la audiencia de engagement (#2654) para ${opts.source} ${opts.sourceId}, ` +
            `incluso con la regla amplia. Probable causa: la cuenta no tiene permiso de audiencias sobre esa fuente ` +
            `o es muy nueva. Crea el remarketing manualmente en Ads Manager. Detalle Meta: ${String(e2?.message ?? e2)}`
        );
      }
    }
    throw e;
  }
}

// ─── Ads ─────────────────────────────────────────────────────────

export async function metaAdsCreateAd(opts: {
  workspaceId: string;
  adsetId: string;
  name: string;
  creativeId: string;
  status?: "PAUSED" | "ACTIVE";
  adhoc?: Record<string, string>;
}): Promise<{ id: string; name: string }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const data = await metaPost<{ id: string }>(
    `${adAccountPath(cfg.adAccountId)}/ads`,
    cfg.accessToken,
    {
      name: opts.name,
      adset_id: opts.adsetId,
      creative: { creative_id: opts.creativeId },
      status: opts.status ?? "PAUSED"
    }
  );
  return { id: data.id, name: opts.name };
}

export async function metaAdsUpdateAd(opts: {
  workspaceId: string;
  adId: string;
  name?: string;
  status?: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  /** Sustituye el creative del ad. Útil para "regenerar imagen": creas
   *  un creative nuevo con la imagen actualizada y haces swap aquí
   *  sin tener que re-crear campaign/adset/form. */
  creativeId?: string;
  adhoc?: Record<string, string>;
}): Promise<{ success: boolean }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const payload: Record<string, unknown> = {};
  if (opts.name) payload.name = opts.name;
  if (opts.status) payload.status = opts.status;
  if (opts.creativeId) payload.creative = { creative_id: opts.creativeId };
  if (Object.keys(payload).length === 0) throw new Error("Pasa al menos un campo");
  await metaPost(`/${opts.adId}`, cfg.accessToken, payload);
  return { success: true };
}

/** Preview HTML del ad — útil para mostrarle al user antes de activar. */
export async function metaAdsGetAdPreview(opts: {
  workspaceId: string;
  adId: string;
  format?: string;
  adhoc?: Record<string, string>;
}): Promise<{ body: string; format: string }> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const format = opts.format ?? "DESKTOP_FEED_STANDARD";
  const data = await metaFetch<any>(
    `${GRAPH}/${opts.adId}/previews?ad_format=${format}`,
    cfg.accessToken
  );
  return { body: data.data?.[0]?.body ?? "", format };
}

// ─── Targeting search (intereses / lugares) ──────────────────────

/**
 * Búsqueda en el árbol de targeting de Meta. Útil para resolver
 * "interés: agencias de viajes" → su ID numérico antes de meterlo
 * en targeting de un adset.
 *
 * type: 'adinterest' | 'adgeolocation' | 'adlocale' | etc.
 */
/**
 * Cache in-memory de targeting search por proceso. Sonia tiende a
 * buscar el mismo término varias veces durante un run (e.g. en V1 del
 * RS Advocats: 6 búsquedas "Empleo" sucesivas). Sin cache son 6
 * round-trips a Graph API = 6-18s + 6 steps consumidos. Con cache:
 * 1 round-trip + 5 hits instantáneos.
 *
 * Key: `<workspaceId>:<type>:<q.toLowerCase().trim()>`
 * TTL: 1h — los intereses Meta no cambian dentro de una sesión.
 * Capacity: 500 entradas (LRU básico por timestamp).
 */
const TARGETING_CACHE_MS = 60 * 60 * 1000;
const TARGETING_CACHE_MAX = 500;
const targetingCache = new Map<
  string,
  { ts: number; data: Array<{ id: string; name: string; type: string; audience_size?: number }> }
>();

function pruneTargetingCache() {
  if (targetingCache.size <= TARGETING_CACHE_MAX) return;
  // Borra el 20% más viejo
  const entries = Array.from(targetingCache.entries()).sort((a, b) => a[1].ts - b[1].ts);
  const toDrop = Math.floor(TARGETING_CACHE_MAX * 0.2);
  for (let i = 0; i < toDrop && i < entries.length; i++) {
    targetingCache.delete(entries[i][0]);
  }
}

export async function metaAdsTargetingSearch(opts: {
  workspaceId: string;
  q: string;
  type?: string;
  limit?: number;
  adhoc?: Record<string, string>;
}): Promise<Array<{ id: string; name: string; type: string; audience_size?: number }>> {
  const type = opts.type ?? "adinterest";
  const key = `${opts.workspaceId}:${type}:${opts.q.toLowerCase().trim()}`;
  const cached = targetingCache.get(key);
  if (cached && Date.now() - cached.ts < TARGETING_CACHE_MS) {
    return cached.data;
  }
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const params = new URLSearchParams({
    q: opts.q,
    type,
    limit: String(opts.limit ?? 25)
  });
  const data = await metaFetch<any>(
    `${GRAPH}/search?${params.toString()}`,
    cfg.accessToken
  );
  const out = (data.data ?? []).map((d: any) => ({
    id: d.id,
    name: d.name,
    type: d.type ?? type,
    audience_size: d.audience_size
  }));
  targetingCache.set(key, { ts: Date.now(), data: out });
  pruneTargetingCache();
  return out;
}

// ─── Macro tool — caso típico que pide Sonia ─────────────────────

/**
 * Orquesta TODO el flujo de creación de una Lead Ads campaign en
 * una sola llamada:
 *   1. Crea campaign (objective OUTCOME_LEADS, PAUSED)
 *   2. Crea adset (LEAD_GENERATION, daily budget, targeting)
 *   3. Crea lead form en la page (questions + privacy policy)
 *   4. Sube imagen del adjunto → image_hash
 *   5. Crea ad_creative con la imagen + lead form
 *   6. Crea ad linked al adset + creative
 *   7. Devuelve todos los IDs + URL de Ads Manager
 *
 * Todo queda en PAUSED — el humano revisa y activa manualmente.
 * Si algún paso falla, los pasos anteriores quedan creados (en
 * PAUSED) — la API de Meta no tiene transacciones. Devolvemos qué
 * se creó y qué falló.
 */
export async function metaAdsCreateLeadCampaign(opts: {
  workspaceId: string;
  campaignName: string;
  pageId: string;
  dailyBudgetEur: number;
  countries: string[];
  ageMin?: number;
  ageMax?: number;
  formName: string;
  formQuestions: Array<{ type: string; key?: string; label?: string; options?: Array<{ key: string; value: string }> }>;
  privacyPolicyUrl: string;
  imageFileId: string;
  adName: string;
  primaryText: string;
  headline?: string;
  description?: string;
  callToAction?: string;
  followUpActionUrl?: string;
  adhoc?: Record<string, string>;
}): Promise<{
  ok: boolean;
  campaignId?: string;
  adsetId?: string;
  formId?: string;
  imageHash?: string;
  creativeId?: string;
  adId?: string;
  adsManagerUrl?: string;
  error?: string;
  step?: string;
}> {
  const cfg = await getMetaAdsConfig(opts.workspaceId, opts.adhoc);
  const adAccount = cfg.adAccountId.startsWith("act_") ? cfg.adAccountId : `act_${cfg.adAccountId}`;
  const adAccountNumeric = adAccount.replace(/^act_/, "");

  const out: any = { ok: false };
  try {
    // 1. Campaign con CBO (budget en campaña, no en adset).
    // Sonia identificó (19 may) que la cuenta act_290451863303865
    // fuerza CBO — si pones budget en adset Meta devuelve subcode
    // 1885737 "Campaña sin presupuesto". El modo correcto en cuentas
    // modernas es CBO (Campaign Budget Optimization): budget en
    // campaign + adsets sin budget. Meta lo respeta.
    out.step = "campaign";
    const campaign = await metaAdsCreateCampaign({
      workspaceId: opts.workspaceId,
      name: opts.campaignName,
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      dailyBudgetEur: opts.dailyBudgetEur,
      adhoc: opts.adhoc
    });
    out.campaignId = campaign.id;

    // 2. Adset SIN budget (CBO lo hereda de campaign), CON
    // promoted_object obligatorio para Lead Ads on-ad (Meta exige
    // page_id — sin esto la API responde 400).
    out.step = "adset";
    const targeting: Record<string, unknown> = {
      geo_locations: { countries: opts.countries },
      // Placements: solo FB + IG, sin audience_network (calidad de
      // lead inferior).
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["feed", "marketplace", "video_feeds", "story", "instream_video"],
      instagram_positions: ["stream", "story", "reels", "explore"]
    };
    if (opts.ageMin) targeting.age_min = opts.ageMin;
    if (opts.ageMax) targeting.age_max = opts.ageMax;
    const adset = await metaAdsCreateAdset({
      workspaceId: opts.workspaceId,
      campaignId: campaign.id,
      name: `${opts.campaignName} — adset`,
      // SIN dailyBudgetEur — el budget vive en la campaign (CBO).
      targeting,
      status: "PAUSED",
      promotedObject: { pageId: opts.pageId },
      adhoc: opts.adhoc
    });
    out.adsetId = adset.id;

    // 3. Lead form
    out.step = "lead_form";
    const form = await metaAdsCreateLeadForm({
      workspaceId: opts.workspaceId,
      pageId: opts.pageId,
      name: opts.formName,
      questions: opts.formQuestions,
      privacyPolicyUrl: opts.privacyPolicyUrl,
      followUpActionUrl: opts.followUpActionUrl,
      adhoc: opts.adhoc
    });
    out.formId = form.id;

    // 4. Imagen
    out.step = "upload_image";
    const image = await metaAdsUploadImage({
      workspaceId: opts.workspaceId,
      fileId: opts.imageFileId,
      adhoc: opts.adhoc
    });
    out.imageHash = image.hash;

    // 5. Creative
    out.step = "creative";
    const creative = await metaAdsCreateAdCreative({
      workspaceId: opts.workspaceId,
      name: `${opts.adName} — creative`,
      pageId: opts.pageId,
      leadFormId: form.id,
      imageHash: image.hash,
      primaryText: opts.primaryText,
      headline: opts.headline,
      description: opts.description,
      callToAction: opts.callToAction ?? "LEARN_MORE",
      adhoc: opts.adhoc
    });
    out.creativeId = creative.id;

    // 6. Ad
    out.step = "ad";
    const ad = await metaAdsCreateAd({
      workspaceId: opts.workspaceId,
      adsetId: adset.id,
      name: opts.adName,
      creativeId: creative.id,
      status: "PAUSED",
      adhoc: opts.adhoc
    });
    out.adId = ad.id;

    out.adsManagerUrl =
      `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${adAccountNumeric}` +
      `&selected_campaign_ids=${campaign.id}`;
    out.ok = true;
    delete out.step;
    return out;
  } catch (e: any) {
    out.error = String(e?.message ?? e);
    return out;
  }
}
