/**
 * Cliente Stripe minimal — sin SDK pesado, solo fetch a Stripe REST API.
 * Solo READ + create payment_link. Para invoicing complejo usa Holded.
 *
 * Config: workspace.settings.integrations.stripe.apiKey (encrypted).
 * Secret key sk_live_... o sk_test_...
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const BASE = "https://api.stripe.com/v1";

async function getApiKey(workspaceId: string): Promise<string> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const enc = (ws?.settings as any)?.integrations?.stripe?.apiKey;
  if (!enc) throw new Error("Stripe no configurado");
  const key = decryptSecret(enc);
  if (!key) throw new Error("Stripe key inválida");
  return key;
}

async function stripeFetch<T = any>(
  workspaceId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const key = await getApiKey(workspaceId);
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": "2024-06-20",
      ...(init.headers ?? {})
    }
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Stripe ${resp.status}: ${txt.slice(0, 200)}`);
  }
  return resp.json();
}

export async function stripeListCustomers(opts: {
  workspaceId: string;
  query?: string;
  limit?: number;
}) {
  const limit = Math.min(opts.limit ?? 20, 100);
  if (opts.query) {
    // Search API (requires test/live mode with index)
    const data = await stripeFetch<any>(
      opts.workspaceId,
      `/customers/search?query=${encodeURIComponent(`name:"${opts.query}" OR email:"${opts.query}"`)}&limit=${limit}`
    );
    return data.data ?? [];
  }
  const data = await stripeFetch<any>(opts.workspaceId, `/customers?limit=${limit}`);
  return data.data ?? [];
}

export async function stripeListInvoices(opts: {
  workspaceId: string;
  customer?: string;
  status?: "draft" | "open" | "paid" | "uncollectible" | "void";
  sinceDays?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(opts.limit ?? 25, 100)));
  if (opts.customer) params.set("customer", opts.customer);
  if (opts.status) params.set("status", opts.status);
  if (opts.sinceDays) {
    const since = Math.floor((Date.now() - opts.sinceDays * 86400_000) / 1000);
    params.set("created[gte]", String(since));
  }
  const data = await stripeFetch<any>(
    opts.workspaceId,
    `/invoices?${params.toString()}`
  );
  return data.data ?? [];
}

export async function stripeListSubscriptions(opts: {
  workspaceId: string;
  customer?: string;
  status?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(opts.limit ?? 25, 100)));
  if (opts.customer) params.set("customer", opts.customer);
  if (opts.status) params.set("status", opts.status);
  const data = await stripeFetch<any>(
    opts.workspaceId,
    `/subscriptions?${params.toString()}`
  );
  return data.data ?? [];
}

export async function stripeCreatePaymentLink(opts: {
  workspaceId: string;
  productName: string;
  amount: number; // céntimos
  currency?: string;
}): Promise<{ id: string; url: string }> {
  // Crear precio inline + payment link
  const price = await stripeFetch<any>(
    opts.workspaceId,
    `/prices`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        currency: opts.currency ?? "eur",
        unit_amount: String(opts.amount),
        "product_data[name]": opts.productName
      }).toString()
    }
  );
  const link = await stripeFetch<any>(
    opts.workspaceId,
    `/payment_links`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        "line_items[0][price]": price.id,
        "line_items[0][quantity]": "1"
      }).toString()
    }
  );
  return { id: link.id, url: link.url };
}

/**
 * Crea un customer en Stripe. Útil tras cerrar deal con un lead nuevo
 * — el customer queda en Stripe listo para cobrarle vía payment_link
 * o subscription.
 */
export async function stripeCreateCustomer(opts: {
  workspaceId: string;
  email: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
}): Promise<{ id: string; email: string }> {
  const body = new URLSearchParams();
  body.set("email", opts.email);
  if (opts.name) body.set("name", opts.name);
  if (opts.phone) body.set("phone", opts.phone);
  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      body.set(`metadata[${k}]`, v);
    }
  }
  const data = await stripeFetch<any>(opts.workspaceId, "/customers", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  return { id: data.id, email: data.email };
}

/**
 * Crea una subscription (recurrente) en Stripe para un customer +
 * un price existente. El price (mensual / anual con € fijos) hay
 * que crearlo previamente en el dashboard de Stripe.
 *
 * Por seguridad, NO cobra inmediatamente — usa trial_period_days
 * o crea la subscription en estado "incomplete" para que el cliente
 * complete el pago vía checkout / payment intent.
 */
export async function stripeCreateSubscription(opts: {
  workspaceId: string;
  customerId: string;
  priceId: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}): Promise<{ id: string; status: string; latest_invoice?: string }> {
  const body = new URLSearchParams();
  body.set("customer", opts.customerId);
  body.set("items[0][price]", opts.priceId);
  if (opts.trialDays) body.set("trial_period_days", String(opts.trialDays));
  body.set("payment_behavior", "default_incomplete");
  body.set("payment_settings[save_default_payment_method]", "on_subscription");
  body.set("expand[]", "latest_invoice.payment_intent");
  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      body.set(`metadata[${k}]`, v);
    }
  }
  const data = await stripeFetch<any>(opts.workspaceId, "/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  return { id: data.id, status: data.status, latest_invoice: data.latest_invoice?.id };
}

/**
 * Lista los products + prices configurados — útil para descubrir
 * qué priceId pasar a stripeCreateSubscription o stripeCreatePaymentLink.
 */
export async function stripeListPrices(opts: {
  workspaceId: string;
  active?: boolean;
  limit?: number;
}): Promise<Array<{ id: string; productName: string; unitAmount: number; currency: string; interval?: string }>> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 50),
    expand: "data.product"
  });
  if (opts.active !== undefined) params.set("active", String(opts.active));
  const data = await stripeFetch<any>(opts.workspaceId, `/prices?${params.toString()}`);
  return (data.data ?? []).map((p: any) => ({
    id: p.id,
    productName: p.product?.name ?? "",
    unitAmount: p.unit_amount ?? 0,
    currency: p.currency ?? "eur",
    interval: p.recurring?.interval
  }));
}

/**
 * Genera un refund de un charge (devolución).
 */
export async function stripeRefundCharge(opts: {
  workspaceId: string;
  chargeId: string;
  amountCents?: number;
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
}): Promise<{ id: string; status: string }> {
  const body = new URLSearchParams();
  body.set("charge", opts.chargeId);
  if (opts.amountCents) body.set("amount", String(opts.amountCents));
  if (opts.reason) body.set("reason", opts.reason);
  const data = await stripeFetch<any>(opts.workspaceId, "/refunds", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  return { id: data.id, status: data.status };
}
