/**
 * POST /api/bipi/stripe/checkout-subscription
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
  isBipiStripeEnabled,
  getOrCreateBipiCustomer,
  createSubscriptionCheckout
} from "@/lib/bipi/stripe";

export const dynamic = "force-dynamic";

const schema = z.object({
  businessId: z.string().min(1),
  plan: z.enum(["pro", "premium"])
});

export async function POST(req: Request) {
  if (!isBipiStripeEnabled()) {
    return NextResponse.json(
      { error: { code: "stripe_disabled", message: "Pagos Bipi no configurados todavía." } },
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
    const customer = await getOrCreateBipiCustomer({
      email: business.ownerEmail,
      name: business.name,
      metadata: { bipi_business_id: business.id, bipi_slug: business.slug },
      existingId: business.bipiStripeCustomerId
    });
    if (customer.id !== business.bipiStripeCustomerId) {
      await prisma.bubuiBusiness.update({
        where: { id: business.id },
        data: { bipiStripeCustomerId: customer.id }
      });
    }
    const origin = new URL(req.url).origin;
    const out = await createSubscriptionCheckout({
      customerId: customer.id,
      plan: parsed.data.plan,
      successUrl: `${origin}/bipi/negocio?upgrade=success`,
      cancelUrl: `${origin}/bipi/negocio?upgrade=cancel`,
      businessId: business.id
    });
    return NextResponse.json({ ok: true, url: out.url });
  } catch (e: any) {
    return NextResponse.json({ error: { code: "stripe_error", message: e?.message ?? String(e) } }, { status: 502 });
  }
}
