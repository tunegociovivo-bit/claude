/** Cliente HTTP minimal apuntando al backend del Hub. */

import Constants from "expo-constants";

export const API_BASE: string =
  (Constants.expoConfig?.extra as any)?.apiBaseUrl ?? "https://hub.negociovivo.app";

async function call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
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
    firstBusinessId?: string;
  }) =>
    call("/api/bubui/customer/verify-otp", {
      method: "POST",
      body: JSON.stringify(args)
    }),
  login: (phone: string, code: string) =>
    call<{ customerId: string; name: string | null; totalSaved: number; totalPurchases: number }>(
      "/api/bubui/customer/login",
      { method: "POST", body: JSON.stringify({ phone, code }) }
    ),
  offers: (customerId: string, lat?: number, lng?: number) => {
    const url = new URL(`${API_BASE}/api/bubui/offers`);
    url.searchParams.set("customerId", customerId);
    if (lat != null) url.searchParams.set("lat", String(lat));
    if (lng != null) url.searchParams.set("lng", String(lng));
    return fetch(url.toString()).then((r) => r.json());
  },
  discover: (lat?: number, lng?: number) => {
    const url = new URL(`${API_BASE}/api/bubui/discover`);
    url.searchParams.set("limit", "60");
    if (lat != null) url.searchParams.set("lat", String(lat));
    if (lng != null) url.searchParams.set("lng", String(lng));
    return fetch(url.toString()).then((r) => r.json());
  },
  scan: (businessId: string, customerId: string, amount: number, scanLat?: number, scanLng?: number) =>
    call("/api/bubui/scan", {
      method: "POST",
      body: JSON.stringify({ businessId, customerId, amount, scanLat, scanLng })
    }),
  vapidPublic: () => call("/api/bubui/push/vapid-public"),
  banner: () => call<{ active: boolean; imageUrl?: string; link?: string }>("/api/bubui/banner"),
  stats: () => call<{ businesses: number }>("/api/bubui/stats"),
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
