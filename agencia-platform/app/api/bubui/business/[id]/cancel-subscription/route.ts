/**
 * POST /api/bubui/business/[id]/cancel-subscription  { resume?: boolean }
 *
 * El negocio cancela su suscripción Pro/Premium. La cancelación es al final
 * del periodo ya pagado (cancel_at_period_end): conserva las ventajas hasta
 * planExpiresAt. Con { resume: true } reactiva una cancelación pendiente.
 *
 * Auth: Bearer <businessId>:<...> (mismo modelo que el resto del panel).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import {
  isBubuiStripeEnabled,
  cancelSubscriptionAtPeriodEnd,
  resumeSubscription
} from "@/lib/bubui/stripe";

export const dynamic = "force-dynamic";

const schema = z.object({ resume: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const businessId = params.id;
  if (!(await businessTokenAllows(req.headers.get("authorization"), businessId))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  if (!isBubuiStripeEnabled()) {
    return NextResponse.json({ error: { code: "stripe_off", message: "Pagos no configurados" } }, { status: 503 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  const resume = parsed.success ? parsed.data.resume === true : false;

  const business = await prisma.bubuiBusiness.findUnique({ where: { id: businessId } });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found", message: "Negocio no existe" } }, { status: 404 });
  }
  if (!business.bubuiStripeSubscriptionId) {
    return NextResponse.json(
      { error: { code: "no_subscription", message: "No tienes una suscripción activa" } },
      { status: 409 }
    );
  }

  try {
    if (resume) {
      await resumeSubscription(business.bubuiStripeSubscriptionId);
      await prisma.bubuiBusiness.update({
        where: { id: businessId },
        data: { subscriptionCancelAt: null }
      });
      return NextResponse.json({ ok: true, resumed: true });
    }
    const { cancelAt } = await cancelSubscriptionAtPeriodEnd(business.bubuiStripeSubscriptionId);
    await prisma.bubuiBusiness.update({
      where: { id: businessId },
      data: { subscriptionCancelAt: cancelAt ?? business.planExpiresAt }
    });
    return NextResponse.json({ ok: true, cancelAt: cancelAt ?? business.planExpiresAt });
  } catch (e: any) {
    console.error("[bubui cancel-subscription]", e?.message ?? e);
    return NextResponse.json(
      { error: { code: "stripe_error", message: "No se pudo procesar con Stripe. Inténtalo de nuevo." } },
      { status: 502 }
    );
  }
}
