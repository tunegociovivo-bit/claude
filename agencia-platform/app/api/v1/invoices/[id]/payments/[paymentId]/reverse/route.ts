import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { reverseInvoicePayment } from "@/lib/invoicing/payment-ledger";

const reversalSchema = z.object({ reason: z.string().trim().min(3).max(1000).optional() });

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  const parsed = reversalSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const result = await prisma.$transaction((tx) =>
    reverseInvoicePayment(tx, {
      workspaceId: api.workspaceId,
      invoiceId: params.id,
      paymentId: params.paymentId,
      reason: parsed.data.reason,
      actorId: api.userId
    })
  );
  return NextResponse.json(result, { status: 201 });
});
