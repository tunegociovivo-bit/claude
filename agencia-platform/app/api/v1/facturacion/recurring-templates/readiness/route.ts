/**
 * GET /api/v1/facturacion/recurring-templates/readiness  (Slice E0)
 *
 * Informe de READINESS de solo lectura: reconcilia los previews shadow del Hub
 * contra las facturas ya generadas por el legado (dual-run), por plantilla +
 * periodo + importe. NO activa, NO congela Holded, NO emite, NO escribe NADA.
 * Admin-only, tenant, doble flag opt-in (recurrentes + motor shadow).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { recurringInvoicesEnabled, recurringEngineEnabled } from "@/lib/facturacion/recurring/flags";
import { readinessReport } from "@/lib/facturacion/recurring/reconcile-store";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  if (!(recurringInvoicesEnabled() && recurringEngineEnabled())) {
    return NextResponse.json({ error: { code: "disabled", message: "Readiness desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);
  const m = Number(new URL(req.url).searchParams.get("months"));
  const months = Number.isFinite(m) && m >= 1 && m <= 24 ? Math.floor(m) : 6;
  const report = await readinessReport(prisma, api.workspaceId, new Date(), months);
  return NextResponse.json({
    ...report,
    // Recordatorio explícito: esto es simulación; no se ha activado ni cambiado nada.
    note: "Simulación de solo lectura. No se ha activado el Hub, congelado Holded ni emitido nada."
  });
});
