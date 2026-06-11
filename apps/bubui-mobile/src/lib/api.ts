/** Cliente HTTP minimal apuntando al backend del Hub. */

import Constants from "expo-constants";
import { Platform } from "react-native";

export const API_BASE: string =
  (Constants.expoConfig?.extra as any)?.apiBaseUrl ?? "https://hub.negociovivo.app";

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
    }>(`/api/bubui/customer/${customerId}`),
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
  /** Info pública del negocio (tras escanear el QR): si exige foto del ticket. */
  businessPublic: (businessId: string) =>
    call<{ id: string; name: string; slug: string; category: string; requireTicket: boolean }>(
      `/api/bubui/business/${businessId}/public`
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
    }>(`/api/bubui/customer/${customerId}/referral`),
  vapidPublic: () => call("/api/bubui/push/vapid-public"),
  banner: () => call<{ active: boolean; imageUrl?: string; link?: string }>("/api/bubui/banner"),
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
