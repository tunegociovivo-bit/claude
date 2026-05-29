/**
 * POST /api/bubui/stripe/checkout-subscription
 *
 * Body: { businessId, plan: "pro" | "premium" }
 *
 * Crea un Stripe Checkout Session para suscribir al negocio al plan
 * elegido. Devuelve { url } — el cliente hace window.location = url.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  isBubuiStripeEnabled,
  getOrCreateBubuiCustomer,
  createSubscriptionCheckout
} from "@/lib/bubui/stripe";

export const dynamic = "force-dynamic";

const schema = z.object({
  businessId: z.string().min(1),
  plan: z.enum(["pro", "premium"])
});

export async function POST(req: Request) {
  if (!isBubuiStripeEnabled()) {
    return NextResponse.json(
      { error: { code: "stripe_disabled", message: "Pagos Bubui no configurados todavía." } },
      { status: 503 }
    );
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const business = await prisma.bubuiBusiness.findUnique({ where: { id: parsed.data.businessId } });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  try {
    const customer = await getOrCreateBubuiCustomer({
      email: business.ownerEmail,
      name: business.name,
      metadata: { bubui_business_id: business.id, bubui_slug: business.slug },
      existingId: business.bubuiStripeCustomerId
    });
    if (customer.id !== business.bubuiStripeCustomerId) {
      await prisma.bubuiBusiness.update({
        where: { id: business.id },
        data: { bubuiStripeCustomerId: customer.id }
      });
    }
    const origin = new URL(req.url).origin;
    const out = await createSubscriptionCheckout({
      customerId: customer.id,
      plan: parsed.data.plan,
      successUrl: `${origin}/bubui/negocio?upgrade=success`,
      cancelUrl: `${origin}/bubui/negocio?upgrade=cancel`,
      businessId: business.id
    });
    return NextResponse.json({ ok: true, url: out.url });
  } catch (e: any) {
    return NextResponse.json({ error: { code: "stripe_error", message: e?.message ?? String(e) } }, { status: 502 });
  }
}
