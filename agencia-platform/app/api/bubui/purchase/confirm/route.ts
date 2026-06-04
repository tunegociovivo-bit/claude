/**
 * POST /api/bubui/purchase/confirm
 *
 * El NEGOCIO confirma o rechaza una compra pendiente desde su panel.
 *
 * Al confirmar:
 *   - Cambia status a "confirmed".
 *   - Marca como redeemed la oferta canjeada (si la hubo).
 *   - Suma ahorro acumulado al cliente.
 *   - Desbloquea las nuevas ofertas (negocios complementarios cerca).
 *   - Recalcula el score de visibilidad del negocio.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import {
  unlockOffersForPurchase,
  recalculateVisibilityScore,
  recalculateAmbassadorLevel
} from "@/lib/bubui/core";

export const dynamic = "force-dynamic";

const schema = z.object({
  purchaseId: z.string().min(1),
  businessId: z.string().min(1), // confirma quien dice ser el negocio (auth simple v1)
  action: z.enum(["confirm", "reject"]),
  rejectionReason: z.string().max(200).optional()
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const d = parsed.data;

  if (!(await businessTokenAllows(req.headers.get("authorization"), d.businessId))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }

  const purchase = await prisma.bubuiPurchase.findUnique({ where: { id: d.purchaseId } });
  if (!purchase) {
    return NextResponse.json({ error: { code: "not_found", message: "Compra no existe" } }, { status: 404 });
  }
  if (purchase.businessId !== d.businessId) {
    return NextResponse.json({ error: { code: "forbidden", message: "Negocio no autorizado" } }, { status: 403 });
  }
  if (purchase.status !== "pending") {
    return NextResponse.json(
      { error: { code: "bad_state", message: `Compra en estado ${purchase.status}, no se puede modificar` } },
      { status: 409 }
    );
  }

  if (d.action === "reject") {
    await prisma.bubuiPurchase.update({
      where: { id: purchase.id },
      data: { status: "rejected", rejectionReason: d.rejectionReason ?? "Rechazada por el negocio" }
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // CONFIRM:
  await prisma.bubuiPurchase.update({
    where: { id: purchase.id },
    data: { status: "confirmed", confirmedAt: new Date() }
  });

  // Si canjea una oferta cruzada, la marcamos redeemed.
  if (purchase.redeemedOfferId) {
    await prisma.bubuiOffer.update({
      where: { id: purchase.redeemedOfferId },
      data: { redeemed: true, redeemedAt: new Date() }
    });
  }

  // Actualiza stats del cliente.
  const customer = await prisma.bubuiCustomer.update({
    where: { id: purchase.customerId },
    data: {
      totalPurchases: { increment: 1 },
      totalSaved: { increment: purchase.discountAmount }
    }
  });

  // Desbloquea ofertas en negocios complementarios cercanos.
  const business = await prisma.bubuiBusiness.findUnique({ where: { id: purchase.businessId } });
  const offers = business
    ? await unlockOffersForPurchase({
        customerId: purchase.customerId,
        triggerBusinessId: purchase.businessId,
        triggerCategory: business.category,
        triggerLat: business.latitude,
        triggerLng: business.longitude
      })
    : { created: 0 };

  // Recalcula score del negocio + nivel embajador del cliente
  // (fire-and-forget, no bloquea respuesta).
  void recalculateVisibilityScore(purchase.businessId).catch(() => {});
  void recalculateAmbassadorLevel(purchase.customerId).catch(() => {});

  // Tarjeta de fidelidad: si esta compra completa el ciclo, otorga el cupón.
  // Best-effort: si falla, la compra ya está confirmada y la siguiente lo
  // intentará al hacer el mod 0 de nuevo. No bloquea respuesta.
  let loyalty: { granted: boolean; cycle?: number; discountPct?: number; label?: string | null } = { granted: false };
  try {
    const { grantLoyaltyIfReached } = await import("@/lib/bubui/loyalty");
    loyalty = await grantLoyaltyIfReached({ customerId: purchase.customerId, businessId: purchase.businessId });
  } catch (e: any) {
    console.warn("[bubui loyalty]", e?.message ?? e);
  }

  // Email de confirmación al cliente (best-effort, no bloquea).
  if (customer.email && business) {
    void import("@/lib/bubui/email").then(({ sendPurchaseConfirmationEmail }) =>
      sendPurchaseConfirmationEmail({
        to: customer.email,
        customerName: customer.name,
        businessName: business.name,
        amount: purchase.amount,
        discountAmount: purchase.discountAmount,
        offersUnlocked: offers.created
      })
    );
  }

  return NextResponse.json({
    ok: true,
    status: "confirmed",
    offersUnlocked: offers.created,
    discountAmount: purchase.discountAmount,
    loyalty
  });
}
