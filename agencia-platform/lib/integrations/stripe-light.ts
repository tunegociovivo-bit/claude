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
