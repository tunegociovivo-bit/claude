/**
 * GET /api/v1/facturacion/recurring-templates  (Slice A — solo lectura)
 *
 * Lista las plantillas recurrentes del workspace + resumen (activas/pausadas/
 * borrador/errores, coste mensual/anual). Admin-only, tenant-scoped. NO expone
 * facturas emitidas (tabla separada). Kill-switch HUB_RECURRING_INVOICES=off → 404.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { recurringInvoicesEnabled } from "@/lib/facturacion/recurring/flags";
import { listTemplates } from "@/lib/facturacion/recurring/store";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  if (!recurringInvoicesEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Módulo de recurrentes desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") ?? undefined;
  // La búsqueda por texto es client-side (dataset acotado); no se expone `q`
  // server-side para no dar una falsa sensación de filtrado tras el `take`.
  const data = await listTemplates(prisma, api.workspaceId, { status });
  return NextResponse.json(data);
});
