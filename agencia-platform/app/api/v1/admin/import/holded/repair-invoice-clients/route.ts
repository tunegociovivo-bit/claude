import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { assertSameOrigin } from "@/lib/api/csrf";
import { repairExistingInvoiceClients, type InvoiceInput } from "@/lib/import/invoices";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  const body = await req.json().catch(() => null);
  const inputs = Array.isArray(body?.inputs) ? body.inputs as InvoiceInput[] : null;
  if (!inputs) throw new ApiError(400, "no_inputs", "Faltan las facturas de Holded");
  if (inputs.length > 5000) throw new ApiError(400, "too_many", "Máximo 5000 facturas por reparación");
  return NextResponse.json(await repairExistingInvoiceClients(api.workspaceId, inputs));
});
