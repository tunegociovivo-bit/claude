/**
 * Cliente Google Business Profile (Google My Business) — Fase 53.
 *
 * Auth: reusa el refreshToken de GoogleAdsConnection. El OAuth necesita
 * el scope `https://www.googleapis.com/auth/business.manage` (si tu
 * conexión solo tiene scope adwords, hay que reconectar).
 *
 * La API de GMB está fragmentada en 4 sub-APIs:
 *   - mybusinessaccountmanagement.googleapis.com (cuentas)
 *   - mybusinessbusinessinformation.googleapis.com (ubicaciones)
 *   - mybusiness.googleapis.com/v4 (reseñas + posts — "soft-deprecated"
 *     pero sin reemplazo a fecha de hoy; Google lo mantiene vivo)
 *   - businessprofileperformance.googleapis.com/v1 (insights)
 *
 * Config opcional por cliente: Client.settings.gmb = { accountId,
 * locationId }. Si el cliente no tiene config, la tool acepta los IDs
 * en cada llamada — Sonia los descubre con gmb_list_accounts /
 * gmb_list_locations.
 *
 * Naming convention de Google: los recursos vienen con "resource names"
 * estilo "accounts/123/locations/456/reviews/abc-def". En los tools
 * usamos los IDs cortos (123, 456) para que el modelo no tenga que
 * arrastrar el prefijo.
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCOUNTS_BASE = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4_BASE = "https://mybusiness.googleapis.com/v4";
const PERF_BASE = "https://businessprofileperformance.googleapis.com/v1";

async function getAccessToken(workspaceId: string): Promise<string> {
  const conn = await prisma.googleAdsConnection.findUnique({ where: { workspaceId } });
  if (!conn) throw new Error("Falta conexión Google. Necesaria para GMB.");
  const refreshToken = decryptSecret(conn.refreshTokenEnc);
  if (!refreshToken) throw new Error("refresh token Google inválido");
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_ADS_CLIENT_ID/SECRET no en env");
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
  if (!r.ok) throw new Error(`Google OAuth refresh ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data.access_token as string;
}

async function gFetch(token: string, url: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  // GMB suele dar 429 al exceder cuota. Devolvemos el body para que
  // el caller pueda decidir si retry o escalar.
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GMB ${r.status} ${url}: ${t.slice(0, 300)}`);
  }
  // Algunos endpoints (DELETE reply) devuelven 200 con body vacío
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return {};
  return r.json();
}

async function resolveLocation(opts: {
  workspaceId: string;
  clientId?: string | null;
  accountId?: string | null;
  locationId?: string | null;
}): Promise<{ accountId: string; locationId: string }> {
  let accountId = opts.accountId ?? null;
  let locationId = opts.locationId ?? null;
  if (accountId && locationId) return { accountId, locationId };
  if (opts.clientId) {
    const c = await prisma.client.findFirst({
      where: { id: opts.clientId, workspaceId: opts.workspaceId }
    });
    const gmb = (c as any)?.settings?.gmb;
    if (!accountId && gmb?.accountId) accountId = String(gmb.accountId);
    if (!locationId && gmb?.locationId) locationId = String(gmb.locationId);
  }
  if (!accountId || !locationId) {
    throw new Error(
      "Falta accountId/locationId de GMB. Usa gmb_list_accounts + gmb_list_locations primero, o configura Client.settings.gmb = {accountId, locationId}."
    );
  }
  return { accountId, locationId };
}

// ────────────────────────────────────────────────────────────────────
// CUENTAS + UBICACIONES
// ────────────────────────────────────────────────────────────────────

export async function gmbListAccounts(workspaceId: string) {
  const token = await getAccessToken(workspaceId);
  const data = await gFetch(token, `${ACCOUNTS_BASE}/accounts?pageSize=50`);
  const accounts = (data.accounts ?? []).map((a: any) => ({
    accountId: String(a.name ?? "").split("/").pop() ?? "",
    name: a.accountName ?? a.name,
    type: a.type,
    role: a.role,
    state: a.state?.status
  }));
  return accounts;
}

export async function gmbListLocations(opts: { workspaceId: string; accountId: string }) {
  const token = await getAccessToken(opts.workspaceId);
  // readMask es OBLIGATORIO en businessinformation v1
  const readMask = "name,title,storeCode,websiteUri,phoneNumbers,categories,storefrontAddress,metadata";
  const data = await gFetch(
    token,
    `${INFO_BASE}/accounts/${opts.accountId}/locations?pageSize=100&readMask=${encodeURIComponent(readMask)}`
  );
  return (data.locations ?? []).map((l: any) => ({
    locationId: String(l.name ?? "").split("/").pop() ?? "",
    title: l.title,
    storeCode: l.storeCode,
    websiteUri: l.websiteUri,
    phone: l.phoneNumbers?.primaryPhone,
    primaryCategory: l.categories?.primaryCategory?.displayName,
    // metadata.mapsUri trae el CID (?cid=…) y placeId — sirve para
    // emparejar una ficha por su URL de Google (fid/cid) cuando la URL
    // no lleva el nombre del negocio.
    placeId: l.metadata?.placeId ?? null,
    mapsUri: l.metadata?.mapsUri ?? null,
    address: l.storefrontAddress
      ? [
          ...(l.storefrontAddress.addressLines ?? []),
          l.storefrontAddress.locality,
          l.storefrontAddress.administrativeArea,
          l.storefrontAddress.postalCode
        ]
          .filter(Boolean)
          .join(", ")
      : null
  }));
}

// ────────────────────────────────────────────────────────────────────
// RESEÑAS — v4 (aún operativo en 2026)
// ────────────────────────────────────────────────────────────────────

export type GmbReview = {
  reviewName: string; // "accounts/X/locations/Y/reviews/Z"
  reviewId: string;
  reviewer: string;
  rating: number; // 1-5
  comment: string | null;
  createTime: string;
  reply: { comment: string; updateTime: string } | null;
};

const STAR_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5
};

export async function gmbListReviews(opts: {
  workspaceId: string;
  clientId?: string;
  accountId?: string;
  locationId?: string;
  pageSize?: number;
  /** "newest" (default) | "oldest" | "rating" | "ratingDesc" */
  orderBy?: string;
}): Promise<GmbReview[]> {
  const { accountId, locationId } = await resolveLocation(opts);
  const token = await getAccessToken(opts.workspaceId);
  const orderBy = opts.orderBy ?? "updateTime desc";
  const pageSize = opts.pageSize ?? 25;
  const url = `${V4_BASE}/accounts/${accountId}/locations/${locationId}/reviews?pageSize=${pageSize}&orderBy=${encodeURIComponent(orderBy)}`;
  const data = await gFetch(token, url);
  return (data.reviews ?? []).map((r: any) => ({
    reviewName: r.name,
    reviewId: String(r.name ?? "").split("/").pop() ?? "",
    reviewer: r.reviewer?.displayName ?? "Anónimo",
    rating: STAR_MAP[r.starRating] ?? 0,
    comment: r.comment ?? null,
    createTime: r.createTime,
    reply: r.reviewReply
      ? { comment: r.reviewReply.comment, updateTime: r.reviewReply.updateTime }
      : null
  }));
}

export async function gmbReplyReview(opts: {
  workspaceId: string;
  /** reviewName completo "accounts/X/locations/Y/reviews/Z" o solo reviewId si pasas account+location */
  reviewName?: string;
  accountId?: string;
  locationId?: string;
  clientId?: string;
  reviewId?: string;
  comment: string;
}): Promise<{ comment: string; updateTime: string }> {
  let path = opts.reviewName;
  if (!path) {
    const { accountId, locationId } = await resolveLocation(opts);
    if (!opts.reviewId) throw new Error("reviewId requerido si no pasas reviewName completo");
    path = `accounts/${accountId}/locations/${locationId}/reviews/${opts.reviewId}`;
  }
  const token = await getAccessToken(opts.workspaceId);
  const data = await gFetch(token, `${V4_BASE}/${path}/reply`, {
    method: "PUT",
    body: JSON.stringify({ comment: opts.comment })
  });
  return { comment: data.comment, updateTime: data.updateTime };
}

export async function gmbDeleteReviewReply(opts: {
  workspaceId: string;
  reviewName?: string;
  accountId?: string;
  locationId?: string;
  reviewId?: string;
  clientId?: string;
}): Promise<{ ok: true }> {
  let path = opts.reviewName;
  if (!path) {
    const { accountId, locationId } = await resolveLocation(opts);
    if (!opts.reviewId) throw new Error("reviewId requerido si no pasas reviewName completo");
    path = `accounts/${accountId}/locations/${locationId}/reviews/${opts.reviewId}`;
  }
  const token = await getAccessToken(opts.workspaceId);
  await gFetch(token, `${V4_BASE}/${path}/reply`, { method: "DELETE" });
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────
// POSTS LOCALES — v4
// ────────────────────────────────────────────────────────────────────

export async function gmbCreatePost(opts: {
  workspaceId: string;
  clientId?: string;
  accountId?: string;
  locationId?: string;
  summary: string; // Cuerpo del post, max ~1500 chars (GMB recorta a ~300 visualmente)
  /** "STANDARD" | "EVENT" | "OFFER" */
  topicType?: "STANDARD" | "EVENT" | "OFFER";
  callToAction?: {
    /** BOOK | ORDER | SHOP | LEARN_MORE | SIGN_UP | CALL */
    actionType: string;
    url?: string;
  };
  mediaUrl?: string; // imagen publica accesible por Google
  /** Para topicType=EVENT */
  eventTitle?: string;
  eventStartIso?: string;
  eventEndIso?: string;
  /** Para topicType=OFFER */
  offerCouponCode?: string;
  offerRedeemUrl?: string;
  offerTerms?: string;
  languageCode?: string; // "es" default
}): Promise<{ postName: string; searchUrl: string | null }> {
  const { accountId, locationId } = await resolveLocation(opts);
  const token = await getAccessToken(opts.workspaceId);
  const body: any = {
    languageCode: opts.languageCode ?? "es",
    summary: opts.summary.slice(0, 1500),
    topicType: opts.topicType ?? "STANDARD"
  };
  if (opts.callToAction) {
    body.callToAction = {
      actionType: opts.callToAction.actionType,
      url: opts.callToAction.url
    };
  }
  if (opts.mediaUrl) {
    body.media = [{ mediaFormat: "PHOTO", sourceUrl: opts.mediaUrl }];
  }
  if (body.topicType === "EVENT" || body.topicType === "OFFER") {
    body.event = {
      title: opts.eventTitle ?? opts.summary.slice(0, 58),
      schedule: {
        startDate: opts.eventStartIso ? isoToDateObj(opts.eventStartIso) : undefined,
        endDate: opts.eventEndIso ? isoToDateObj(opts.eventEndIso) : undefined
      }
    };
  }
  if (body.topicType === "OFFER") {
    body.offer = {
      couponCode: opts.offerCouponCode,
      redeemOnlineUrl: opts.offerRedeemUrl,
      termsConditions: opts.offerTerms
    };
  }
  const url = `${V4_BASE}/accounts/${accountId}/locations/${locationId}/localPosts`;
  const data = await gFetch(token, url, { method: "POST", body: JSON.stringify(body) });
  return { postName: data.name, searchUrl: data.searchUrl ?? null };
}

function isoToDateObj(iso: string): { year: number; month: number; day: number } | undefined {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

// ────────────────────────────────────────────────────────────────────
// INSIGHTS — businessprofileperformance v1
// ────────────────────────────────────────────────────────────────────

const DEFAULT_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_DIRECTION_REQUESTS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS"
];

export async function gmbGetInsights(opts: {
  workspaceId: string;
  clientId?: string;
  accountId?: string;
  locationId?: string;
  /** YYYY-MM-DD. Default últimos 30 días terminando ayer. */
  since?: string;
  until?: string;
  metrics?: string[];
}) {
  const { locationId } = await resolveLocation(opts);
  const token = await getAccessToken(opts.workspaceId);
  const today = new Date();
  const end = opts.until ? new Date(opts.until) : new Date(today.getTime() - 86400_000);
  const start = opts.since ? new Date(opts.since) : new Date(end.getTime() - 29 * 86400_000);
  const metrics = opts.metrics ?? DEFAULT_METRICS;
  const params = new URLSearchParams();
  for (const m of metrics) params.append("dailyMetrics", m);
  params.append("dailyRange.startDate.year", String(start.getFullYear()));
  params.append("dailyRange.startDate.month", String(start.getMonth() + 1));
  params.append("dailyRange.startDate.day", String(start.getDate()));
  params.append("dailyRange.endDate.year", String(end.getFullYear()));
  params.append("dailyRange.endDate.month", String(end.getMonth() + 1));
  params.append("dailyRange.endDate.day", String(end.getDate()));
  const url = `${PERF_BASE}/locations/${locationId}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`;
  const data = await gFetch(token, url);
  // Resumimos: total por métrica + serie diaria.
  const series = (data.multiDailyMetricTimeSeries ?? []).flatMap((s: any) =>
    (s.dailyMetricTimeSeries ?? []).map((m: any) => {
      const points = (m.timeSeries?.datedValues ?? []).map((d: any) => ({
        date: `${d.date?.year}-${String(d.date?.month).padStart(2, "0")}-${String(d.date?.day).padStart(2, "0")}`,
        value: Number(d.value ?? 0)
      }));
      const total = points.reduce((a: number, p: { value: number }) => a + p.value, 0);
      return { metric: m.dailyMetric, total, points };
    })
  );
  return {
    locationId,
    range: {
      since: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
      until: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`
    },
    summary: Object.fromEntries(series.map((s: any) => [s.metric, s.total])),
    series
  };
}
