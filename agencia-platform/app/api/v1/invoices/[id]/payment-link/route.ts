import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { stripeCreatePaymentLink } from "@/lib/integrations/stripe-light";
import { TYPE_LABEL, type InvoiceType } from "@/lib/invoicing/core";

export const POST = withApi({ scope: "*", rate: "admin" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const inv = await prisma.invoice.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!inv) throw new ApiError(404, "not_found", "Factura no encontrada");
  if (inv.totalCents <= 0) throw new ApiError(400, "empty_total", "La factura no tiene importe a cobrar");

  // Idempotencia: si ya hay un link de pago, devolvemos ese (un reintento de
  // red no debe crear varios links de Stripe para la misma factura).
  if (inv.stripePaymentLinkUrl) {
    return NextResponse.json({ url: inv.stripePaymentLinkUrl, reused: true });
  }

  const label = TYPE_LABEL[inv.type as InvoiceType] ?? "Factura";
  const productName = `${label} ${inv.number ?? ""}`.trim();

  const { url } = await stripeCreatePaymentLink({
    workspaceId: api.workspaceId,
    productName,
    amount: inv.totalCents,
    currency: (inv.currency || "EUR").toLowerCase()
  });

  await prisma.invoice.update({ where: { id: inv.id }, data: { stripePaymentLinkUrl: url } });
  return NextResponse.json({ url });
});
