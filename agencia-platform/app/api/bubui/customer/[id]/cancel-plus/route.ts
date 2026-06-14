/**
 * POST /api/bubui/customer/[id]/cancel-plus  { resume?: boolean }
 *
 * El usuario cancela su suscripción Bubui Plus. La cancelación es al final
 * del periodo ya pagado (cancel_at_period_end): conserva las ventajas hasta
 * planExpiresAt. Con { resume: true } reactiva una cancelación pendiente.
 *
 * Auth: Bearer <customerId>:<token>.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { isBubuiStripeEnabled, cancelSubscriptionAtPeriodEnd, resumeSubscription } from "@/lib/bubui/stripe";

export const dynamic = "force-dynamic";

const schema = z.object({ resume: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const customerId = params.id;
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  if (!isBubuiStripeEnabled()) {
    return NextResponse.json({ error: { code: "stripe_off", message: "Pagos no configurados" } }, { status: 503 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  const resume = parsed.success ? parsed.data.resume === true : false;

  const customer = await prisma.bubuiCustomer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  if (!customer.bubuiStripeSubscriptionId) {
    return NextResponse.json(
      { error: { code: "no_subscription", message: "No tienes una suscripción activa" } },
      { status: 409 }
    );
  }
  try {
    if (resume) {
      await resumeSubscription(customer.bubuiStripeSubscriptionId);
      await prisma.bubuiCustomer.update({ where: { id: customerId }, data: { subscriptionCancelAt: null } });
      return NextResponse.json({ ok: true, resumed: true });
    }
    const { cancelAt } = await cancelSubscriptionAtPeriodEnd(customer.bubuiStripeSubscriptionId);
    await prisma.bubuiCustomer.update({
      where: { id: customerId },
      data: { subscriptionCancelAt: cancelAt ?? customer.planExpiresAt }
    });
    return NextResponse.json({ ok: true, cancelAt: cancelAt ?? customer.planExpiresAt });
  } catch (e: any) {
    console.error("[bubui cancel-plus]", e?.message ?? e);
    return NextResponse.json(
      { error: { code: "stripe_error", message: "No se pudo procesar con Stripe. Inténtalo de nuevo." } },
      { status: 502 }
    );
  }
}
