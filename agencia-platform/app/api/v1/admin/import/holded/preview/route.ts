/**
 * GET /api/v1/admin/import/holded/preview?entity=clients|invoices
 *
 * Trae clientes o facturas de Holded y devuelve la MISMA forma que el
 * preview por archivo ({ entity, count, inputs, plan }) para reutilizar la
 * confirmación con POST /api/v1/admin/import/apply (que acepta issuerId).
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { buildClientPlan } from "@/lib/import/clients";
import { buildInvoicePlan } from "@/lib/import/invoices";
import { holdedContactsAsClients, holdedInvoicesAsInputs } from "@/lib/import/holded-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const entity = new URL(req.url).searchParams.get("entity") === "clients" ? "clients" : "invoices";

  try {
    if (entity === "invoices") {
      const inputs = await holdedInvoicesAsInputs(api.workspaceId);
      const plan = await buildInvoicePlan(api.workspaceId, inputs);
      return NextResponse.json({ entity, source: "holded", count: inputs.length, inputs, plan });
    }
    const inputs = await holdedContactsAsClients(api.workspaceId);
    const plan = await buildClientPlan(api.workspaceId, inputs);
    return NextResponse.json({ entity, source: "holded", count: inputs.length, inputs, plan });
  } catch (e: any) {
    throw new ApiError(400, "holded_error", e?.message ?? "No se pudo conectar con Holded");
  }
});
