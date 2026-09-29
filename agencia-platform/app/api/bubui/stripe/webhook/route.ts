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

import type { Prisma } from "@prisma/client";
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

  if (!event?.id || !event?.type) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  try {
    await prisma.$transaction(async (db) => {
      // Claim and business changes commit together. A database outage is retryable.
      await db.bubuiProcessedWebhook.create({ data: { id: String(event.id) } });
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
          const session = event.data?.object;
          await handleCheckoutCompleted(session, db);
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const sub = event.data?.object;
          await handleSubscriptionUpsert(sub, db);
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data?.object;
          await handleSubscriptionDeleted(sub, db);
          break;
        }
        case "invoice.paid": {
          const inv = event.data?.object;
          if (inv?.subscription) {
            // Si la factura renovó la suscripción, asegura que el plan sigue
            // activo extendiendo planExpiresAt (cogemos current_period_end
            // del último update).
            await handleInvoicePaid(inv, db);
          }
          break;
        }
        default:
          // Ignoramos los demás (charge.refunded, etc.) — el negocio puede
          // resolver disputas vía Stripe Dashboard.
          break;
      }
    });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ ok: true, duplicate: true });
    console.error("[bubui stripe webhook]", event?.type, e?.message ?? e);
    return NextResponse.json({ ok: false, error: e?.message ?? "internal" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function handleCheckoutCompleted(session: any, db: Prisma.TransactionClient): Promise<void> {
  const businessId: string | undefined = session?.metadata?.bubui_business_id;
  const kind: string | undefined = session?.metadata?.bubui_kind;
  if (!businessId) return;

  // Es un Push del Día → marca el ad como ready y activa.
  if (kind === "push_ad") {
    if (session?.payment_status !== "paid") return;
    const adId = session?.metadata?.bubui_ad_id;
    if (typeof adId !== "string" || !adId) throw new Error("push_ad_missing_id");
    const ad = await db.bubuiPushAd.findUnique({ where: { id: adId } });
    if (!ad || ad.businessId !== businessId || session.currency !== "eur" ||
        session.amount_total !== Math.round(ad.pricePaidEur * 100)) throw new Error("push_ad_payment_mismatch");
    await db.bubuiPushAd.updateMany({
      where: { id: ad.id, businessId, status: "scheduled" },
      data: { status: "ready" }
    });
    return;
  }

  // Edición extra de Banner IA → concede 1 crédito al negocio.
  if (kind === "ai_banner" && session?.payment_status === "paid") {
    await db.bubuiBusiness.update({
      where: { id: businessId },
      data: { aiBannerCredits: { increment: 1 } }
    });
    return;
  }

  // Subscription → ya nos llegará customer.subscription.created. No hacemos
  // nada aquí.
}

async function handleSubscriptionUpsert(sub: any, db: Prisma.TransactionClient): Promise<void> {
  // Suscripción de USUARIO (Bubui Plus) — se distingue por metadata.
  const customerId: string | undefined = sub?.metadata?.bubui_customer_id;
  if (customerId) {
    await handleCustomerPlusUpsert(sub, customerId, db);
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
  await db.bubuiBusiness.update({
    where: { id: businessId },
    data: {
      plan: isActive ? plan : "free",
      bubuiStripeSubscriptionId: sub.id,
      planExpiresAt: isActive ? currentPeriodEnd : null,
      subscriptionCancelAt: isActive ? cancelAt : null
    }
  });
}

async function handleSubscriptionDeleted(sub: any, db: Prisma.TransactionClient): Promise<void> {
  const customerId: string | undefined = sub?.metadata?.bubui_customer_id;
  if (customerId) {
    await db.bubuiCustomer
      .update({
        where: { id: customerId },
        data: { plan: "free", bubuiStripeSubscriptionId: null, planExpiresAt: null, subscriptionCancelAt: null }
      })
      .catch((error) => { if (error?.code !== "P2025") throw error; });
    return;
  }
  const businessId: string | undefined = sub?.metadata?.bubui_business_id;
  if (!businessId) return;
  await db.bubuiBusiness.update({
    where: { id: businessId },
    data: { plan: "free", bubuiStripeSubscriptionId: null, planExpiresAt: null, subscriptionCancelAt: null }
  });
}

/** Activa/actualiza el plan Bubui Plus de un usuario según su suscripción. */
async function handleCustomerPlusUpsert(sub: any, customerId: string, db: Prisma.TransactionClient): Promise<void> {
  const status = sub?.status;
  const currentPeriodEnd = sub?.current_period_end ? new Date(sub.current_period_end * 1000) : null;
  const isActive = ["active", "trialing", "past_due"].includes(status);
  const cancelAt =
    sub?.cancel_at_period_end && sub?.cancel_at ? new Date(sub.cancel_at * 1000) : null;
  await db.bubuiCustomer
    .update({
      where: { id: customerId },
      data: {
        plan: isActive ? "plus" : "free",
        bubuiStripeSubscriptionId: sub.id,
        planExpiresAt: isActive ? currentPeriodEnd : null,
        subscriptionCancelAt: isActive ? cancelAt : null
      }
    })
    .catch((error) => { if (error?.code !== "P2025") throw error; });
}

async function handleInvoicePaid(inv: any, db: Prisma.TransactionClient): Promise<void> {
  // Si periodEnd llega aquí, lo refrescamos en el negocio o el usuario.
  const subId = inv?.subscription;
  if (!subId) return;
  const periodEnd = inv?.lines?.data?.[0]?.period?.end;
  if (!periodEnd) return;
  const newExpiry = new Date(periodEnd * 1000);
  const business = await db.bubuiBusiness.findFirst({
    where: { bubuiStripeSubscriptionId: subId }
  });
  if (business) {
    await db.bubuiBusiness.update({ where: { id: business.id }, data: { planExpiresAt: newExpiry } });
    return;
  }
  // Renovación de Bubui Plus (usuario).
  const customer = await db.bubuiCustomer.findFirst({
    where: { bubuiStripeSubscriptionId: subId }
  });
  if (customer) {
    await db.bubuiCustomer.update({ where: { id: customer.id }, data: { planExpiresAt: newExpiry } });
  }
}
