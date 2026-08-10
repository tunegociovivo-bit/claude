import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { deliverInvoice } from "@/lib/invoicing/invoice-delivery";

const schema = z.object({
  recipient: z.string().trim().email().optional(),
  operationId: z.string().uuid()
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const dedupeKey = `invoice:${params.id}:${parsed.data.operationId}`;
  const delivery = await deliverInvoice({
    workspaceId: api.workspaceId,
    invoiceId: params.id,
    recipient: parsed.data.recipient,
    kind: "INVOICE",
    dedupeKey,
    actorId: api.userId
  });
  return NextResponse.json({ delivery }, { status: 201 });
});
