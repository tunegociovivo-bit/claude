import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { registerInvoicePayment, reverseInvoicePayment } from "@/lib/invoicing/payment-ledger";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  const inv = await prisma.invoice.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!inv) throw new ApiError(404, "not_found", "Factura no encontrada");

  const body = await req.json().catch(() => ({}));
  const paid = body?.paid !== false; // por defecto marca como pagada
  // Un presupuesto/proforma no se "paga" (su ciclo es ACCEPTED/REJECTED).
  if (paid && (inv.type === "PRESUPUESTO" || inv.type === "PROFORMA")) {
    throw new ApiError(400, "invalid_state", "Un presupuesto o proforma no puede marcarse como pagado.");
  }
  if (paid) {
    if (inv.paidCents >= inv.totalCents) return NextResponse.json(inv);
    const result = await prisma.$transaction((tx) =>
      registerInvoicePayment(tx, {
        workspaceId: api.workspaceId,
        invoiceId: inv.id,
        amountCents: inv.totalCents - inv.paidCents,
        occurredAt: new Date(),
        method: inv.paymentMethod,
        notes: "Cobro total registrado desde la acción rápida",
        actorId: api.userId
      })
    );
    return NextResponse.json(result.invoice);
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${inv.id}))`;
    const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    if (fresh.status === "CANCELLED") {
      throw new ApiError(409, "invoice_cancelled", "No se puede modificar el saldo de una factura anulada.");
    }
    const payments = await tx.invoicePayment.findMany({
      where: { invoiceId: inv.id, workspaceId: api.workspaceId, kind: "PAYMENT" },
      select: { id: true }
    });
    for (const payment of payments) {
      const alreadyReversed = await tx.invoicePayment.findUnique({ where: { reversesPaymentId: payment.id } });
      if (!alreadyReversed) {
        await reverseInvoicePayment(tx, {
          workspaceId: api.workspaceId,
          invoiceId: inv.id,
          paymentId: payment.id,
          reason: "Reapertura manual de factura",
          actorId: api.userId
        });
      }
    }
    if (payments.length === 0) {
      await tx.invoiceEvent.create({
        data: {
          workspaceId: api.workspaceId,
          invoiceId: inv.id,
          type: "LEGACY_PAYMENT_REOPENED",
          actorId: api.userId,
          data: { previousPaidCents: fresh.paidCents }
        }
      });
      return tx.invoice.update({
        where: { id: inv.id },
        data: { status: inv.number ? "ISSUED" : "DRAFT", paidAt: null, paidCents: 0 }
      });
    }
    return tx.invoice.findUniqueOrThrow({ where: { id: inv.id } });
  });
  return NextResponse.json(updated);
});
