import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { registerInvoicePayment } from "@/lib/invoicing/payment-ledger";

const paymentSchema = z.object({
  amountCents: z.number().int().positive(),
  occurredAt: z.string().datetime().optional(),
  method: z.enum(["STRIPE", "TRANSFER", "REMITTANCE", "CARD", "CASH", "OTHER"]).default("TRANSFER"),
  reference: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable()
});

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true }
  });
  if (!invoice) throw new ApiError(404, "not_found", "Factura no encontrada");
  const payments = await prisma.invoicePayment.findMany({
    where: { invoiceId: invoice.id, workspaceId: api.workspaceId },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }]
  });
  return NextResponse.json({ payments });
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  const parsed = paymentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const result = await prisma.$transaction((tx) =>
    registerInvoicePayment(tx, {
      workspaceId: api.workspaceId,
      invoiceId: params.id,
      ...parsed.data,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date(),
      actorId: api.userId
    })
  );
  return NextResponse.json(result, { status: 201 });
});
