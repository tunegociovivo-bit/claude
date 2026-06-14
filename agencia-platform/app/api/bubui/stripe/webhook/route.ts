/**
 * POST /api/bubui/stripe/webhook
 *
 * Recibe eventos de Stripe relevantes para Bubui y actualiza estado en BD.
 * Tipos manejados:
 *   - checkout.session.completed (push ad o suscripción)
 *   - customer.subscription.created / updated / deleted (cambios de plan)
 *   - invoice.paid (renovación mensual)
 *
 * Verifica la firma HMAC con BUBUI_STRIPE_WEBHOOK_SECRET. Si no está
 * configurado, devuelve 503.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyStripeSignature } from "@/lib/bubui/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.BUBUI_STRIPE_WEBHOOK_SECRET;
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

  // Idempotencia: Stripe puede reentregar el mismo evento. Reclamamos su id;
  // si ya estaba procesado, no hacemos nada (evita doble crédito de Banner IA,
  // doble activación, etc.). Si el procesado falla, liberamos el id para que
  // Stripe reintente.
  if (event?.id) {
    try {
      await prisma.bubuiProcessedWebhook.create({ data: { id: String(event.id) } });
    } catch {
      return NextResponse.json({ ok: true, duplicate: true });
    }
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
    console.error("[bubui stripe webhook]", event?.type, e?.message ?? e);
    // Liberamos el id reclamado para que el reintento de Stripe reprocese.
    if (event?.id) {
      await prisma.bubuiProcessedWebhook.delete({ where: { id: String(event.id) } }).catch(() => {});
    }
    return NextResponse.json({ ok: false, error: e?.message ?? "internal" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function handleCheckoutCompleted(session: any): Promise<void> {
  const businessId: string | undefined = session?.metadata?.bubui_business_id;
  const kind: string | undefined = session?.metadata?.bubui_kind;
  if (!businessId) return;

  // Es un Push del Día → marca el ad como ready y activa.
  if (kind === "push_ad") {
    const adId = session?.metadata?.bubui_ad_id;
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
      void sendBubuiPushAd(ad.id).catch((e) =>
        console.warn("[bubui push-ad dispatch]", e?.message ?? e)
      );
    }
    return;
  }

  // Edición extra de Banner IA → concede 1 crédito al negocio.
  if (kind === "ai_banner") {
    await prisma.bubuiBusiness.update({
      where: { id: businessId },
      data: { aiBannerCredits: { increment: 1 } }
    });
    return;
  }

  // Subscription → ya nos llegará customer.subscription.created. No hacemos
  // nada aquí.
}

async function handleSubscriptionUpsert(sub: any): Promise<void> {
  // Suscripción de USUARIO (Bubui Plus) — se distingue por metadata.
  const customerId: string | undefined = sub?.metadata?.bubui_customer_id;
  if (customerId) {
    await handleCustomerPlusUpsert(sub, customerId);
    return;
  }
  const businessId: string | undefined = sub?.metadata?.bubui_business_id;
  const plan: string | undefined = sub?.metadata?.bubui_plan;
  if (!businessId || !plan) return;
  const status = sub?.status;
  const currentPeriodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;
  // Plan activo si subscription está en active/trialing/past_due.
  const isActive = ["active", "trialing", "past_due"].includes(status);
  // Cancelación programada: Stripe pone cancel_at_period_end=true y cancel_at.
  const cancelAt =
    sub?.cancel_at_period_end && sub?.cancel_at ? new Date(sub.cancel_at * 1000) : null;
  await prisma.bubuiBusiness.update({
    where: { id: businessId },
    data: {
      plan: isActive ? plan : "free",
      bubuiStripeSubscriptionId: sub.id,
      planExpiresAt: isActive ? currentPeriodEnd : null,
      subscriptionCancelAt: isActive ? cancelAt : null
    }
  });
}

async function handleSubscriptionDeleted(sub: any): Promise<void> {
  const customerId: string | undefined = sub?.metadata?.bubui_customer_id;
  if (customerId) {
    await prisma.bubuiCustomer
      .update({
        where: { id: customerId },
        data: { plan: "free", bubuiStripeSubscriptionId: null, planExpiresAt: null, subscriptionCancelAt: null }
      })
      .catch(() => {});
    return;
  }
  const businessId: string | undefined = sub?.metadata?.bubui_business_id;
  if (!businessId) return;
  await prisma.bubuiBusiness.update({
    where: { id: businessId },
    data: { plan: "free", bubuiStripeSubscriptionId: null, planExpiresAt: null, subscriptionCancelAt: null }
  });
}

/** Activa/actualiza el plan Bubui Plus de un usuario según su suscripción. */
async function handleCustomerPlusUpsert(sub: any, customerId: string): Promise<void> {
  const status = sub?.status;
  const currentPeriodEnd = sub?.current_period_end ? new Date(sub.current_period_end * 1000) : null;
  const isActive = ["active", "trialing", "past_due"].includes(status);
  const cancelAt =
    sub?.cancel_at_period_end && sub?.cancel_at ? new Date(sub.cancel_at * 1000) : null;
  await prisma.bubuiCustomer
    .update({
      where: { id: customerId },
      data: {
        plan: isActive ? "plus" : "free",
        bubuiStripeSubscriptionId: sub.id,
        planExpiresAt: isActive ? currentPeriodEnd : null,
        subscriptionCancelAt: isActive ? cancelAt : null
      }
    })
    .catch(() => {});
}

async function handleInvoicePaid(inv: any): Promise<void> {
  // Si periodEnd llega aquí, lo refrescamos en el negocio o el usuario.
  const subId = inv?.subscription;
  if (!subId) return;
  const periodEnd = inv?.lines?.data?.[0]?.period?.end;
  if (!periodEnd) return;
  const newExpiry = new Date(periodEnd * 1000);
  const business = await prisma.bubuiBusiness.findFirst({
    where: { bubuiStripeSubscriptionId: subId }
  });
  if (business) {
    await prisma.bubuiBusiness.update({ where: { id: business.id }, data: { planExpiresAt: newExpiry } });
    return;
  }
  // Renovación de Bubui Plus (usuario).
  const customer = await prisma.bubuiCustomer.findFirst({
    where: { bubuiStripeSubscriptionId: subId }
  });
  if (customer) {
    await prisma.bubuiCustomer.update({ where: { id: customer.id }, data: { planExpiresAt: newExpiry } });
  }
}

/** Envía el push del Push del Día a clientes Bubui en el radio configurado.
 *  v1 simple: filtra por última geolocalización registrada del cliente y
 *  por suscripción push activa. */
async function sendBubuiPushAd(adId: string): Promise<void> {
  const ad = await prisma.bubuiPushAd.findUnique({
    where: { id: adId },
    include: { business: { select: { name: true } } }
  });
  if (!ad) return;

  const { haversineMeters } = await import("@/lib/bubui/core");
  const { notifyBubuiCustomer } = await import("@/lib/bubui/notify");

  // Candidatos: clientes con CUALQUIER canal push (web PWA o token móvil) y
  // última ubicación reciente. Antes solo se miraban las suscripciones web,
  // dejando fuera a los usuarios de la app móvil.
  const [webSubs, mobileSubs] = await Promise.all([
    prisma.bubuiPushSubscription.findMany({ select: { customerId: true }, distinct: ["customerId"] }),
    prisma.bubuiMobilePushToken.findMany({ select: { customerId: true }, distinct: ["customerId"] })
  ]);
  const candidateIds = Array.from(
    new Set([...webSubs.map((s) => s.customerId), ...mobileSubs.map((s) => s.customerId)])
  );
  let sent = 0;
  for (const customerId of candidateIds) {
    const c = await prisma.bubuiCustomer.findUnique({ where: { id: customerId } });
    if (!c?.lastLat || !c?.lastLng) continue;
    const d = haversineMeters(c.lastLat, c.lastLng, ad.centerLat, ad.centerLng);
    if (d > ad.radiusKm * 1000) continue;
    await notifyBubuiCustomer(c.id, {
      title: ad.title,
      body: ad.body,
      image: ad.imageUrl ?? undefined,
      link: `/bubui/app`,
      tag: `pushad-${ad.id}`
    });
    sent++;
  }
  await prisma.bubuiPushAd.update({
    where: { id: ad.id },
    data: { sentCount: sent, status: "done" }
  });
}
