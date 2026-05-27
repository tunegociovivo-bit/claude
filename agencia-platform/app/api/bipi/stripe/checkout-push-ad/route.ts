/**
 * POST /api/bipi/stripe/checkout-push-ad
 *
 * Body: { businessId, title, body, radiusKm, startsAt }
 *
 * Flujo:
 * 1. Cotiza precio dinámico (lib/bipi/core dynamicPushPriceEur).
 * 2. Crea Stripe Checkout Session (pago único).
 * 3. Crea el BipiPushAd en estado "scheduled" con pricePaidEur=quoted.
 *    Al confirmar el pago, el webhook lo activa.
 *
 * Devuelve { url } para que el navegador redirija al checkout.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  isBipiStripeEnabled,
  getOrCreateBipiCustomer,
  createPushAdCheckout
} from "@/lib/bipi/stripe";
import { dynamicPushPriceEur } from "@/lib/bipi/core";

export const dynamic = "force-dynamic";

const schema = z.object({
  businessId: z.string().min(1),
  title: z.string().min(3).max(80),
  body: z.string().min(5).max(180),
  radiusKm: z.number().positive().max(10),
  startsAt: z.string().datetime().optional()
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
  const d = parsed.data;
  const business = await prisma.bipiBusiness.findUnique({ where: { id: d.businessId } });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  if (business.latitude == null || business.longitude == null) {
    return NextResponse.json(
      { error: { code: "no_geo", message: "El negocio no tiene coordenadas. Edita su perfil para añadirlas." } },
      { status: 409 }
    );
  }

  const { reach, priceEur } = dynamicPushPriceEur({
    radiusKm: d.radiusKm,
    city: business.city
  });
  try {
    const customer = await getOrCreateBipiCustomer({
      email: business.ownerEmail,
      name: business.name,
      existingId: business.bipiStripeCustomerId
    });
    if (customer.id !== business.bipiStripeCustomerId) {
      await prisma.bipiBusiness.update({
        where: { id: business.id },
        data: { bipiStripeCustomerId: customer.id }
      });
    }
    // Creamos el BipiPushAd en estado "scheduled" (pendiente de pago).
    const startsAt = d.startsAt ? new Date(d.startsAt) : new Date();
    const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
    const ad = await prisma.bipiPushAd.create({
      data: {
        businessId: business.id,
        title: d.title,
        body: d.body,
        radiusKm: d.radiusKm,
        centerLat: business.latitude,
        centerLng: business.longitude,
        reach,
        pricePaidEur: priceEur,
        startsAt,
        endsAt,
        status: "scheduled"
      }
    });
    const origin = new URL(req.url).origin;
    const out = await createPushAdCheckout({
      customerId: customer.id,
      priceEur,
      reach,
      radiusKm: d.radiusKm,
      businessId: business.id,
      successUrl: `${origin}/bipi/negocio?ad=${ad.id}&pay=success`,
      cancelUrl: `${origin}/bipi/negocio?ad=${ad.id}&pay=cancel`
    });
    return NextResponse.json({ ok: true, url: out.url, adId: ad.id, reach, priceEur });
  } catch (e: any) {
    return NextResponse.json({ error: { code: "stripe_error", message: e?.message ?? String(e) } }, { status: 502 });
  }
}
