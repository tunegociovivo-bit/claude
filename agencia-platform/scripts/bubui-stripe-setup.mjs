#!/usr/bin/env node
/**
 * Crea (o reutiliza) los productos y precios de suscripción de Bubui en
 * Stripe, e imprime los `price_…` que hay que poner en Railway como
 * BUBUI_STRIPE_PRICE_PRO, BUBUI_STRIPE_PRICE_PREMIUM y BUBUI_STRIPE_PRICE_PLUS.
 *
 * Idempotente: usa `lookup_key` por precio, así que reejecutarlo no
 * duplica nada — reutiliza el precio existente y muestra su id.
 *
 * Uso:
 *   BUBUI_STRIPE_SECRET_KEY=sk_test_... node scripts/bubui-stripe-setup.mjs
 *
 * Mismo estilo que lib/bubui/stripe.ts: fetch directo a la REST API, sin SDK.
 */

const BASE = "https://api.stripe.com/v1";
const KEY = process.env.BUBUI_STRIPE_SECRET_KEY;

if (!KEY) {
  console.error(
    "✗ Falta BUBUI_STRIPE_SECRET_KEY.\n" +
      "  Ejecuta:  BUBUI_STRIPE_SECRET_KEY=sk_test_... node scripts/bubui-stripe-setup.mjs"
  );
  process.exit(1);
}

const MODE = KEY.startsWith("sk_live_") ? "LIVE 🔴" : "TEST 🧪";

/** Planes a crear. amountCents = importe mensual en céntimos de EUR. */
const PLANS = [
  { key: "pro", name: "Bubui Pro", amountCents: 2900, lookupKey: "bubui_pro_monthly", envVar: "BUBUI_STRIPE_PRICE_PRO" },
  { key: "premium", name: "Bubui Premium", amountCents: 9900, lookupKey: "bubui_premium_monthly", envVar: "BUBUI_STRIPE_PRICE_PREMIUM" },
  { key: "plus", name: "Bubui Plus", amountCents: 100, lookupKey: "bubui_plus_monthly", envVar: "BUBUI_STRIPE_PRICE_PLUS" }
];

async function stripe(path, init = {}) {
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Stripe-Version": "2024-06-20",
      ...(init.headers ?? {})
    }
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Stripe ${resp.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

function form(obj) {
  const b = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) b.set(k, String(v));
  return b;
}

/** Busca un precio activo por lookup_key (o null si no existe). */
async function findPriceByLookupKey(lookupKey) {
  const data = await stripe(`/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`);
  return data?.data?.[0] ?? null;
}

async function ensurePlan(plan) {
  const existing = await findPriceByLookupKey(plan.lookupKey);
  if (existing) {
    return { priceId: existing.id, reused: true, amountCents: existing.unit_amount };
  }
  // Crea producto + precio recurrente mensual en EUR con lookup_key estable.
  const product = await stripe("/products", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      name: plan.name,
      "metadata[bubui_plan]": plan.key
    })
  });
  const price = await stripe("/prices", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      product: product.id,
      currency: "eur",
      unit_amount: plan.amountCents,
      "recurring[interval]": "month",
      lookup_key: plan.lookupKey,
      "metadata[bubui_plan]": plan.key
    })
  });
  return { priceId: price.id, reused: false, amountCents: price.unit_amount };
}

async function main() {
  console.log(`\nBubui · setup de Stripe  —  modo ${MODE}\n`);
  const results = [];
  for (const plan of PLANS) {
    process.stdout.write(`• ${plan.name} (${(plan.amountCents / 100).toFixed(2)} €/mes)… `);
    const r = await ensurePlan(plan);
    console.log(r.reused ? `reutilizado ${r.priceId}` : `creado ${r.priceId}`);
    results.push({ ...plan, ...r });
  }

  console.log("\n──────────────────────────────────────────────");
  console.log("Pega estas variables en Railway (Variables) y redeploy:\n");
  for (const r of results) {
    console.log(`${r.envVar}=${r.priceId}`);
  }
  console.log("\nTambién necesitas (ver docs/BUBUI_STRIPE_SETUP.md):");
  console.log("  BUBUI_STRIPE_SECRET_KEY      = la sk_… que has usado aquí");
  console.log("  BUBUI_STRIPE_WEBHOOK_SECRET  = whsec_… del webhook que crees en Stripe");
  console.log("──────────────────────────────────────────────\n");
}

main().catch((e) => {
  console.error("\n✗ Error:", e?.message ?? e);
  process.exit(1);
});
