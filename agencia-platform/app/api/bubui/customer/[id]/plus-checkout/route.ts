/**
 * POST /api/bubui/customer/[id]/plus-checkout
 *
 * Crea un Stripe Checkout Session de suscripción "Bubui Plus" (1€/mes) para
 * el usuario y devuelve { url }. La app abre esa URL en el navegador (el
 * cobro ocurre en la web para no pasar por la compra integrada de las
 * tiendas). El webhook activa el plan al confirmarse el pago.
 *
 * Auth: Bearer <customerId>:<token>.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { isBubuiPlusConfigured, getOrCreateBubuiCustomer, createPlusCheckout } from "@/lib/bubui/stripe";
import { getPlusEnabled } from "@/lib/bubui/plus";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const customerId = params.id;
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  // Oculto por el admin (o sin precio configurado) → no se puede dar de alta.
  if (!isBubuiPlusConfigured() || !(await getPlusEnabled())) {
    return NextResponse.json(
      { error: { code: "plus_disabled", message: "Bubui Plus no está disponible todavía." } },
      { status: 503 }
    );
  }
  const customer = await prisma.bubuiCustomer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  try {
    const stripeCustomer = await getOrCreateBubuiCustomer({
      email: customer.email,
      name: customer.name ?? customer.email,
      metadata: { bubui_customer_id: customer.id },
      existingId: customer.bubuiStripeCustomerId
    });
    if (stripeCustomer.id !== customer.bubuiStripeCustomerId) {
      await prisma.bubuiCustomer.update({
        where: { id: customer.id },
        data: { bubuiStripeCustomerId: stripeCustomer.id }
      });
    }
    const origin = new URL(req.url).origin;
    const out = await createPlusCheckout({
      customerId: stripeCustomer.id,
      bubuiCustomerId: customer.id,
      successUrl: `${origin}/bubui/app?plus=ok`,
      cancelUrl: `${origin}/bubui/app?plus=cancel`
    });
    return NextResponse.json({ ok: true, url: out.url });
  } catch (e: any) {
    return NextResponse.json(
      { error: { code: "stripe_error", message: e?.message ?? String(e) } },
      { status: 502 }
    );
  }
}
