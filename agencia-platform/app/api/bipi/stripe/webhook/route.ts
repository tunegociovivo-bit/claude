/**
 * POST /api/bipi/stripe/webhook
 *
 * Recibe eventos de Stripe relevantes para Bipi y actualiza estado en BD.
 * Tipos manejados:
 *   - checkout.session.completed (push ad o suscripción)
 *   - customer.subscription.created / updated / deleted (cambios de plan)
 *   - invoice.paid (renovación mensual)
 *
 * Verifica la firma HMAC con BIPI_STRIPE_WEBHOOK_SECRET. Si no está
 * configurado, devuelve 503.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyStripeSignature } from "@/lib/bipi/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.BIPI_STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  const rawBody = await req.text();
  if (!verifyStripeSignature({ rawBody, header: sig, secret })) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data?.object;
        await handleCheckoutCompleted(session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data?.object;
        await handleSubscriptionUpsert(sub);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data?.object;
        await handleSubscriptionDeleted(sub);
        break;
      }
      case "invoice.paid": {
        const inv = event.data?.object;
        if (inv?.subscription) {
          // Si la factura renovó la suscripción, asegura que el plan sigue
          // activo extendiendo planExpiresAt (cogemos current_period_end
          // del último update).
          await handleInvoicePaid(inv);
        }
        break;
      }
      default:
        // Ignoramos los demás (charge.refunded, etc.) — el negocio puede
        // resolver disputas vía Stripe Dashboard.
        break;
    }
  } catch (e: any) {
    console.error("[bipi stripe webhook]", event?.type, e?.message ?? e);
    return NextResponse.json({ ok: false, error: e?.message ?? "internal" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function handleCheckoutCompleted(session: any): Promise<void> {
  const businessId: string | undefined = session?.metadata?.bipi_business_id;
  const kind: string | undefined = session?.metadata?.bipi_kind;
  if (!businessId) return;

  // Es un Push del Día → marca el ad como ready y activa.
  if (kind === "push_ad") {
    const adId = session?.metadata?.bipi_ad_id;
    // Buscamos el ad más reciente scheduled del negocio si no nos pasaron id
    // (Stripe no lo guarda salvo que lo añadamos como metadata — lo
    // hacemos en una iteración futura; v1 confiamos en que hay uno).
    const ad = await prisma.bubuiPushAd.findFirst({
      where: { businessId, status: "scheduled" },
      orderBy: { createdAt: "desc" }
    });
    if (ad) {
      await prisma.bubuiPushAd.update({
        where: { id: ad.id },
        data: { status: "sending" }
      });
      // Disparo del push en background (no bloquea webhook).
      void sendBipiPushAd(ad.id).catch((e) =>
        console.warn("[bipi push-ad dispatch]", e?.message ?? e)
      );
    }
    return;
  }

  // Subscription → ya nos llegará customer.subscription.created. No hacemos
  // nada aquí.
}

async function handleSubscriptionUpsert(sub: any): Promise<void> {
  const businessId: string | undefined = sub?.metadata?.bipi_business_id;
  const plan: string | undefined = sub?.metadata?.bipi_plan;
  if (!businessId || !plan) return;
  const status = sub?.status;
  const currentPeriodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;
  // Plan activo si subscription está en active/trialing/past_due.
  const isActive = ["active", "trialing", "past_due"].includes(status);
  await prisma.bubuiBusiness.update({
    where: { id: businessId },
    data: {
      plan: isActive ? plan : "free",
      bipiStripeSubscriptionId: sub.id,
      planExpiresAt: isActive ? currentPeriodEnd : null
    }
  });
}

async function handleSubscriptionDeleted(sub: any): Promise<void> {
  const businessId: string | undefined = sub?.metadata?.bipi_business_id;
  if (!businessId) return;
  await prisma.bubuiBusiness.update({
    where: { id: businessId },
    data: { plan: "free", bipiStripeSubscriptionId: null, planExpiresAt: null }
  });
}

async function handleInvoicePaid(inv: any): Promise<void> {
  // Si periodEnd llega aquí, lo refrescamos en el negocio.
  const subId = inv?.subscription;
  if (!subId) return;
  const business = await prisma.bubuiBusiness.findFirst({
    where: { bipiStripeSubscriptionId: subId }
  });
  if (!business) return;
  const periodEnd = inv?.lines?.data?.[0]?.period?.end;
  if (periodEnd) {
    await prisma.bubuiBusiness.update({
      where: { id: business.id },
      data: { planExpiresAt: new Date(periodEnd * 1000) }
    });
  }
}

/** Envía el push del Push del Día a clientes Bipi en el radio configurado.
 *  v1 simple: filtra por última geolocalización registrada del cliente y
 *  por suscripción push activa. */
async function sendBipiPushAd(adId: string): Promise<void> {
  const ad = await prisma.bubuiPushAd.findUnique({
    where: { id: adId },
    include: { business: { select: { name: true } } }
  });
  if (!ad) return;

  const { haversineMeters } = await import("@/lib/bipi/core");
  const { sendPushToBipiCustomer, isBipiPushEnabled } = await import("@/lib/bipi/push");
  if (!isBipiPushEnabled()) {
    await prisma.bubuiPushAd.update({ where: { id: ad.id }, data: { status: "done" } });
    return;
  }

  // Candidatos: clientes con suscripción push y última ubicación reciente.
  const subs = await prisma.bubuiPushSubscription.findMany({
    select: { customerId: true },
    distinct: ["customerId"]
  });
  let sent = 0;
  for (const s of subs) {
    const c = await prisma.bubuiCustomer.findUnique({ where: { id: s.customerId } });
    if (!c?.lastLat || !c?.lastLng) continue;
    const d = haversineMeters(c.lastLat, c.lastLng, ad.centerLat, ad.centerLng);
    if (d > ad.radiusKm * 1000) continue;
    await sendPushToBipiCustomer(c.id, {
      title: ad.title,
      body: ad.body,
      link: `/bipi/app`,
      tag: `pushad-${ad.id}`
    });
    sent++;
  }
  await prisma.bubuiPushAd.update({
    where: { id: ad.id },
    data: { sentCount: sent, status: "done" }
  });
}
