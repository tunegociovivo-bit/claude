/**
 * POST /api/v1/facturacion/recurring-templates/shadow-run  (Slice C)
 *
 * Ejecuta el motor recurrente NATIVO en modo SHADOW: calcula ocurrencias debidas
 * y persiste PREVIEWS idempotentes (nunca facturas reales; sin número, sin emitir/
 * enviar/cobrar). Anti doble-factura por unicidad (workspace,template,occurrence).
 * Admin-only, tenant, opt-in (HUB_RECURRING_ENGINE=on). No hay cron automático.
 *
 * GET (…?templateId=) lista las previews existentes.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { recurringInvoicesEnabled, recurringEngineEnabled } from "@/lib/facturacion/recurring/flags";
import { runShadow, listPreviews } from "@/lib/facturacion/recurring/shadow-engine";

export const dynamic = "force-dynamic";

function gate() {
  return recurringInvoicesEnabled() && recurringEngineEnabled();
}

export const POST = withApi({ scope: "*", rate: "admin" }, async (_req, { api }) => {
  if (!gate()) {
    return NextResponse.json({ error: { code: "disabled", message: "Motor recurrente (shadow) desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);
  const result = await runShadow(prisma, api.workspaceId);
  return NextResponse.json({ mode: "shadow", ...result });
});

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  if (!gate()) {
    return NextResponse.json({ error: { code: "disabled", message: "Motor recurrente (shadow) desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);
  const templateId = new URL(req.url).searchParams.get("templateId") ?? undefined;
  return NextResponse.json(await listPreviews(prisma, api.workspaceId, templateId));
});
