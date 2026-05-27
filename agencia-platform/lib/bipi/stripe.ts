/**
 * Stripe wrapper para Bipi — sin SDK, fetch directo a la REST API.
 *
 * Se configura vía env (independiente del Hub):
 *   BIPI_STRIPE_SECRET_KEY  → sk_test_... o sk_live_...
 *   BIPI_STRIPE_WEBHOOK_SECRET → para verificar firma del webhook
 *   BIPI_STRIPE_PRICE_PRO    → price_xxx (29€/mes)
 *   BIPI_STRIPE_PRICE_PREMIUM → price_xxx (99€/mes)
 *
 * Si no están configuradas, los endpoints responden 503 cleanly y la UI
 * oculta los botones de upgrade.
 */

import { createHmac, timingSafeEqual } from "crypto";

const BASE = "https://api.stripe.com/v1";

export function isBipiStripeEnabled(): boolean {
  return Boolean(process.env.BIPI_STRIPE_SECRET_KEY);
}

function getKey(): string {
  const k = process.env.BIPI_STRIPE_SECRET_KEY;
  if (!k) throw new Error("BIPI_STRIPE_SECRET_KEY no configurada");
  return k;
}

async function stripeFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "Stripe-Version": "2024-06-20",
      ...(init.headers ?? {})
    }
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Stripe ${resp.status}: ${txt.slice(0, 300)}`);
  }
  return resp.json() as Promise<T>;
}

/** Crea un customer Stripe para un negocio Bipi (idempotente: si ya
 *  tiene bipiStripeCustomerId, lo devuelve). */
export async function getOrCreateBipiCustomer(opts: {
  email: string;
  name: string;
  metadata?: Record<string, string>;
  existingId?: string | null;
}): Promise<{ id: string }> {
  if (opts.existingId) return { id: opts.existingId };
  const body = new URLSearchParams();
  body.set("email", opts.email);
  body.set("name", opts.name);
  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      body.set(`metadata[${k}]`, v);
    }
  }
  const data = await stripeFetch<any>("/customers", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  return { id: data.id };
}

/** Crea un Checkout Session de suscripción Pro o Premium. */
export async function createSubscriptionCheckout(opts: {
  customerId: string;
  plan: "pro" | "premium";
  successUrl: string;
  cancelUrl: string;
  businessId: string;
}): Promise<{ url: string }> {
  const priceId =
    opts.plan === "pro" ? process.env.BIPI_STRIPE_PRICE_PRO : process.env.BIPI_STRIPE_PRICE_PREMIUM;
  if (!priceId) throw new Error(`Price del plan ${opts.plan} no configurado`);
  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("customer", opts.customerId);
  body.set("line_items[0][price]", priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", opts.successUrl);
  body.set("cancel_url", opts.cancelUrl);
  body.set("metadata[bipi_business_id]", opts.businessId);
  body.set("metadata[bipi_plan]", opts.plan);
  body.set("subscription_data[metadata][bipi_business_id]", opts.businessId);
  body.set("subscription_data[metadata][bipi_plan]", opts.plan);
  const data = await stripeFetch<any>("/checkout/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  return { url: data.url };
}

/** Crea Checkout Session de pago único para un "Push del Día". */
export async function createPushAdCheckout(opts: {
  customerId: string;
  priceEur: number;
  reach: number;
  radiusKm: number;
  businessId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("customer", opts.customerId);
  body.set("line_items[0][price_data][currency]", "eur");
  body.set("line_items[0][price_data][unit_amount]", String(Math.round(opts.priceEur * 100)));
  body.set("line_items[0][price_data][product_data][name]", `Bipi · Push del Día (${opts.radiusKm}km, ${opts.reach} alcance estimado)`);
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", opts.successUrl);
  body.set("cancel_url", opts.cancelUrl);
  body.set("metadata[bipi_business_id]", opts.businessId);
  body.set("metadata[bipi_kind]", "push_ad");
  body.set("metadata[radius_km]", String(opts.radiusKm));
  body.set("payment_intent_data[metadata][bipi_business_id]", opts.businessId);
  body.set("payment_intent_data[metadata][bipi_kind]", "push_ad");
  const data = await stripeFetch<any>("/checkout/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  return { url: data.url, sessionId: data.id };
}

/** Verifica la firma `stripe-signature` del webhook con timing-safe. */
export function verifyStripeSignature(opts: {
  rawBody: string;
  header: string;
  secret: string;
  toleranceSec?: number;
}): boolean {
  const TOL = opts.toleranceSec ?? 300;
  // Parse "t=...,v1=..."
  const parts = opts.header.split(",").reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  // Comprobamos tolerance (anti-replay).
  const tsSec = Number(t);
  if (!Number.isFinite(tsSec)) return false;
  if (Math.abs(Date.now() / 1000 - tsSec) > TOL) return false;
  const signedPayload = `${t}.${opts.rawBody}`;
  const expected = createHmac("sha256", opts.secret).update(signedPayload).digest("hex");
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(v1, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
