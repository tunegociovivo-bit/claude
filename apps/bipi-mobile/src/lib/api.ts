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
    call("/api/bipi/customer/signup", {
      method: "POST",
      body: JSON.stringify({ email, name, firstBusinessId })
    }),
  requestOtp: (phone: string) =>
    call("/api/bipi/customer/request-otp", {
      method: "POST",
      body: JSON.stringify({ phone })
    }),
  verifyOtp: (phone: string, code: string, name: string, email?: string, firstBusinessId?: string) =>
    call("/api/bipi/customer/verify-otp", {
      method: "POST",
      body: JSON.stringify({ phone, code, name, email, firstBusinessId })
    }),
  offers: (customerId: string, lat?: number, lng?: number) => {
    const url = new URL(`${API_BASE}/api/bipi/offers`);
    url.searchParams.set("customerId", customerId);
    if (lat != null) url.searchParams.set("lat", String(lat));
    if (lng != null) url.searchParams.set("lng", String(lng));
    return fetch(url.toString()).then((r) => r.json());
  },
  scan: (businessId: string, customerId: string, amount: number, scanLat?: number, scanLng?: number) =>
    call("/api/bipi/scan", {
      method: "POST",
      body: JSON.stringify({ businessId, customerId, amount, scanLat, scanLng })
    }),
  vapidPublic: () => call("/api/bipi/push/vapid-public"),
  subscribePush: (customerId: string, subscription: any, userAgent?: string) =>
    call("/api/bipi/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ customerId, subscription, userAgent })
    })
};
