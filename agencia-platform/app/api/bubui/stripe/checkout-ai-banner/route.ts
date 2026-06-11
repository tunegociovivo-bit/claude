/**
 * POST /api/bubui/stripe/checkout-ai-banner   (Authorization: Bearer <token negocio>)
 *
 * Body: { businessId }
 *
 * Crea un Stripe Checkout de pago único (1€) para una edición extra del
 * Banner IA. Al confirmar el pago, el webhook concede 1 crédito
 * (aiBannerCredits) al negocio, que podrá gastar generando otro banner.
 *
 * Devuelve { url } para redirigir al checkout.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import {
  isBubuiStripeEnabled,
  getOrCreateBubuiCustomer,
  createAiBannerCheckout
} from "@/lib/bubui/stripe";

export const dynamic = "force-dynamic";

const schema = z.object({ businessId: z.string().min(1) });

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
  const { businessId } = parsed.data;
  if (!(await businessTokenAllows(req.headers.get("authorization"), businessId))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const business = await prisma.bubuiBusiness.findUnique({ where: { id: businessId } });
  if (!business) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  try {
    const customer = await getOrCreateBubuiCustomer({
      email: business.ownerEmail,
      name: business.name,
      existingId: business.bubuiStripeCustomerId
    });
    if (customer.id !== business.bubuiStripeCustomerId) {
      await prisma.bubuiBusiness.update({
        where: { id: business.id },
        data: { bubuiStripeCustomerId: customer.id }
      });
    }
    const origin = new URL(req.url).origin;
    const out = await createAiBannerCheckout({
      customerId: customer.id,
      businessId: business.id,
      successUrl: `${origin}/bubui/negocio?aibanner=success`,
      cancelUrl: `${origin}/bubui/negocio?aibanner=cancel`
    });
    return NextResponse.json({ ok: true, url: out.url });
  } catch (e: any) {
    return NextResponse.json({ error: { code: "stripe_error", message: e?.message ?? String(e) } }, { status: 502 });
  }
}
