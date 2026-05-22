import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { applyClientImport, type ClientInput } from "@/lib/import/clients";
import { applyInvoiceImport, type InvoiceInput } from "@/lib/import/invoices";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const body = await req.json().catch(() => null);
  const entity = String(body?.entity || "clients");
  const inputs = Array.isArray(body?.inputs) ? body.inputs : null;
  if (!inputs) throw new ApiError(400, "no_inputs", "Faltan los datos a importar");
  if (inputs.length > 5000) throw new ApiError(400, "too_many", "Máximo 5000 filas por importación");

  if (entity === "invoices") {
    const res = await applyInvoiceImport(api.workspaceId, inputs as InvoiceInput[]);
    return NextResponse.json(res);
  }
  const res = await applyClientImport(api.workspaceId, inputs as ClientInput[]);
  return NextResponse.json(res);
});
