/** Cliente HTTP minimal apuntando al backend del Hub. */

import Constants from "expo-constants";
import { Platform } from "react-native";
import type { BusinessLite } from "../screens/Negocio";

/** Ficha que el banner del Home puede abrir al tocarlo (comercio real o
 *  promoción interna sintética). Tiene la misma forma que BusinessLite, así
 *  que se puede navegar directamente a la pantalla Negocio. */
export type BannerBusiness = BusinessLite;

/** Paso del checklist de la Mesa Colectiva (espejo de lib/bubui/table-deal). */
export type MesaStep = {
  key: "quorum" | "share" | "review";
  label: string;
  pct: number;
  euros: number;
  done: boolean;
};

/** Estado calculado de una Mesa Colectiva (espejo del backend). */
export type MesaState = {
  pctNow: number;
  pctNextVisit: number;
  maxPotentialPct: number;
  diners: number;
  quorum: boolean;
  everyonePaidEntry: boolean;
  pendingContributors: number;
  everyoneShared: boolean;
  everyoneReviewed: boolean;
  steps: MesaStep[];
  euros: {
    ticket: number;
    savedNow: number;
    savedNextVisit: number;
    maxSaving: number;
    payNow: number;
    leftOnTable: number;
  } | null;
};

export const API_BASE: string =
  (Constants.expoConfig?.extra as any)?.apiBaseUrl ?? "https://bubui.app";

// Versión de la app instalada — se envía al backend para saber qué build tiene
// cada usuario (panel admin). appBuild = versionCode (Android) / buildNumber (iOS).
const _cfg = Constants.expoConfig as any;
const APP_VERSION: string = _cfg?.version ?? "";
const APP_BUILD: string = String(_cfg?.android?.versionCode ?? _cfg?.ios?.buildNumber ?? "");

// Token de sesión del cliente. Lo fija session.ts al iniciar/guardar sesión.
// Se envía como `Authorization: Bearer <customerId>:<token>` en cada llamada.
let auth: { customerId: string; token: string } | null = null;
export function setAuth(a: { customerId: string; token: string } | null): void {
  auth = a;
}
function authHeaders(): Record<string, string> {
  return auth ? { Authorization: `Bearer ${auth.customerId}:${auth.token}` } : {};
}

async function call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init.headers ?? {}) }
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
  }
  return r.json();
}

export const api = {
  customerSignup: (email: string, name: string, firstBusinessId?: string) =>
    call("/api/bubui/customer/signup", {
      method: "POST",
      body: JSON.stringify({ email, name, firstBusinessId })
    }),
  requestOtp: (phone: string) =>
    call("/api/bubui/customer/request-otp", {
      method: "POST",
      body: JSON.stringify({ phone })
    }),
  verifyOtp: (args: {
    phone: string;
    code: string;
    name: string;
    email: string;
    birthDate: string;
    gender: string;
    postalCode?: string;
    firstBusinessId?: string;
  }) =>
    call("/api/bubui/customer/verify-otp", {
      method: "POST",
      body: JSON.stringify(args)
    }),
  login: (phone: string, code: string) =>
    call<{ customerId: string; name: string | null; totalSaved: number; totalPurchases: number; token: string }>(
      "/api/bubui/customer/login",
      { method: "POST", body: JSON.stringify({ phone, code }) }
    ),
  // Stats vivas del cliente (total ahorrado, compras…). El total guardado en
  // la sesión local se queda obsoleto en cuanto el negocio confirma una
  // compra; esto lo refresca.
  customerSummary: (customerId: string) =>
    call<{
      customerId: string;
      name: string | null;
      totalSaved: number;
      totalPurchases: number;
      activeOffers: number;
      plan?: string;
      plusActive?: boolean;
      plusEnabled?: boolean;
      planExpiresAt?: string | null;
      subscriptionCancelAt?: string | null;
      // Hucha de referidos: % acumulado (0 si caducó), caducidad y amigos cualificados.
      referralWalletPct?: number;
      referralWalletExpiresAt?: string | null;
      referralQualifiedCount?: number;
    }>(`/api/bubui/customer/${customerId}`),
  /** Inicia el checkout de Bubui Plus (1€/mes). Devuelve la URL de Stripe que
   *  la app abre en el navegador (el cobro ocurre en web). */
  plusCheckout: (customerId: string) =>
    call<{ ok: true; url: string }>(`/api/bubui/customer/${customerId}/plus-checkout`, { method: "POST" }),
  /** Cancela (o reactiva con resume) la suscripción Bubui Plus. */
  cancelPlus: (customerId: string, resume?: boolean) =>
    call<{ ok: true; cancelAt?: string | null; resumed?: boolean }>(
      `/api/bubui/customer/${customerId}/cancel-plus`,
      { method: "POST", body: JSON.stringify({ resume: !!resume }) }
    ),
  /** Regalos exclusivos del usuario (solo si es Plus). */
  plusGifts: (customerId: string) =>
    call<{
      plusActive: boolean;
      gifts: { id: string; title: string; description: string | null; imageUrl: string | null; link: string | null }[];
    }>(`/api/bubui/customer/${customerId}/plus-gifts`),
  offers: (customerId: string, lat?: number, lng?: number) => {
    const url = new URL(`${API_BASE}/api/bubui/offers`);
    url.searchParams.set("customerId", customerId);
    if (lat != null) url.searchParams.set("lat", String(lat));
    if (lng != null) url.searchParams.set("lng", String(lng));
    // Reporta la versión instalada (para el panel admin).
    if (APP_VERSION) url.searchParams.set("appVersion", APP_VERSION);
    if (APP_BUILD) url.searchParams.set("appBuild", APP_BUILD);
    url.searchParams.set("appPlatform", Platform.OS);
    return fetch(url.toString(), { headers: authHeaders() }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  },
  discover: (lat?: number, lng?: number, customerId?: string) => {
    const url = new URL(`${API_BASE}/api/bubui/discover`);
    url.searchParams.set("limit", "60");
    if (lat != null) url.searchParams.set("lat", String(lat));
    if (lng != null) url.searchParams.set("lng", String(lng));
    if (customerId) url.searchParams.set("customerId", customerId);
    return fetch(url.toString(), { headers: authHeaders() }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  },
  scan: (
    businessId: string,
    customerId: string,
    amount: number,
    scanLat?: number,
    scanLng?: number,
    ticketUrl?: string,
    ticketScanId?: string
  ) =>
    call("/api/bubui/scan", {
      method: "POST",
      body: JSON.stringify({ businessId, customerId, amount, scanLat, scanLng, ticketUrl, ticketScanId })
    }),
  /** Info pública del negocio (tras escanear el QR): si exige foto del ticket y
   *  si tiene Mesa Colectiva activa (para ofrecer el flujo de grupo). */
  businessPublic: (businessId: string) =>
    call<{
      id: string;
      name: string;
      slug: string;
      category: string;
      requireTicket: boolean;
      businessType?: string;
      mesaEnabled?: boolean;
    }>(`/api/bubui/business/${businessId}/public`),
  // ── Mesa Colectiva ──────────────────────────────────────────────────────
  /** El anfitrión crea la mesa tras escanear el QR del local. Devuelve el code
   *  que su app convierte en QR de grupo para que se unan los demás. */
  mesaCreate: (businessId: string, customerId: string, tableLabel?: string) =>
    call<{ ok: true; code: string; sessionId: string; expiresAt: string; state: MesaState | null }>(
      "/api/bubui/table",
      { method: "POST", body: JSON.stringify({ businessId, customerId, tableLabel }) }
    ),
  /** Un comensal se une a la mesa con el código (escaneado o tecleado). */
  mesaJoin: (code: string, customerId: string) =>
    call<{ ok: true; sessionId: string; state: MesaState | null }>(
      `/api/bubui/table/${encodeURIComponent(code)}/join`,
      { method: "POST", body: JSON.stringify({ customerId }) }
    ),
  /** Estado en vivo de la mesa (para refrescar comensales/aportes). */
  mesaState: (code: string, ticket?: number) => {
    const url = new URL(`${API_BASE}/api/bubui/table/${encodeURIComponent(code)}`);
    if (ticket != null) url.searchParams.set("ticket", String(ticket));
    return fetch(url.toString(), { headers: authHeaders() }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{
        ok: true;
        sessionId: string;
        status: string;
        tableLabel: string | null;
        business: {
          id: string;
          name: string;
          googlePlaceId: string | null;
          reviewPlatform: string;
          reviewPlatformLabel: string;
          reviewUrl: string | null;
          perkLabel: string | null;
          actions: ("share" | "review" | "photo" | "follow")[];
        };
        expiresAt: string;
        state: MesaState | null;
      }>;
    });
  },
  /** Registra un aporte del comensal (compartir/reseña/…) → desbloquea su parte. */
  mesaContribute: (code: string, customerId: string, type: "share" | "review" | "photo" | "follow") =>
    call<{ ok: true; state: MesaState | null }>(
      `/api/bubui/table/${encodeURIComponent(code)}/contribute`,
      { method: "POST", body: JSON.stringify({ customerId, type }) }
    ),
  /** Sube la foto de un ticket; la IA devuelve el importe total leído, la URL
   *  donde quedó guardado y un ticketScanId (importe de confianza para el scan). */
  readTicket: (customerId: string, uri: string) => {
    const fd = new FormData();
    fd.append("customerId", customerId);
    fd.append("file", { uri, name: "ticket.jpg", type: "image/jpeg" } as any);
    return fetch(`${API_BASE}/api/bubui/scan/read-ticket`, { method: "POST", body: fd, headers: authHeaders() }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      return j as { amount: number | null; currency: string; confidence: number; ticketUrl: string | null; ticketScanId: string | null };
    });
  },
  referral: (customerId: string) =>
    call<{
      code: string;
      verifiedReferrals: number;
      originBusiness: string | null;
      referralEnabled: boolean;
      milestones: { n: number; reward: string; unlocked: boolean }[];
      nextMilestone: number | null;
      friends: { initial: string; verified: boolean; joinedAt: string }[];
      ambassadors: {
        myPosition: number | null;
        myReferrals: number;
        total: number;
        top: { position: number; initial: string; referrals: number; isMe: boolean }[];
      } | null;
    }>(`/api/bubui/customer/${customerId}/referral`),
  vapidPublic: () => call("/api/bubui/push/vapid-public"),
  banner: () =>
    call<{ active: boolean; imageUrl?: string; link?: string; business?: BannerBusiness }>("/api/bubui/banner"),
  stats: () => call<{ businesses: number; sections?: { discover: boolean; mapa: boolean } }>("/api/bubui/stats"),
  registerPushToken: (args: { customerId: string; token: string; platform: "ios" | "android" }) =>
    call<{ ok: true }>("/api/bubui/customer/push-token/register", {
      method: "POST",
      body: JSON.stringify(args)
    }),
  subscribePush: (customerId: string, subscription: any, userAgent?: string) =>
    call("/api/bubui/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ customerId, subscription, userAgent })
    })
};
