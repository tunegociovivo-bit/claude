/**
 * POST /api/v1/facturacion/recurring-templates/backfill  (Slice B)
 *
 * Migra el legado `Invoice.recurring` → RecurringInvoiceTemplate.
 *   mode:"preview"  (por defecto) → DRY-RUN, informe de conflictos, NO escribe.
 *   mode:"commit"   → escribe/actualiza plantillas `draft` (idempotente, reversible).
 *   mode:"rollback" → borra SOLO lo backfilled (source LEGACY_INVOICE).
 *
 * Admin-only, tenant-scoped, opt-in (HUB_RECURRING_INVOICES=on). NO toca facturas
 * legadas ni el motor legado; NO emite/envía/cobra; NO llama a Holded.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { recurringInvoicesEnabled } from "@/lib/facturacion/recurring/flags";
import { previewBackfill, commitBackfill, rollbackBackfill } from "@/lib/facturacion/recurring/backfill-store";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  if (!recurringInvoicesEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Módulo de recurrentes desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "commit" || body?.mode === "rollback" ? body.mode : "preview";
  const ws = api.workspaceId;

  if (mode === "preview") {
    return NextResponse.json({ mode, ...(await previewBackfill(prisma, ws)) });
  }
  if (mode === "rollback") {
    return NextResponse.json({ mode, ...(await rollbackBackfill(prisma, ws)) });
  }
  // commit
  return NextResponse.json({ mode, ...(await commitBackfill(prisma, ws, api.userId ?? null)) });
});
