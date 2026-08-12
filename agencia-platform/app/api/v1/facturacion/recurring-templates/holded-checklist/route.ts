/**
 * POST /api/v1/facturacion/recurring-templates/holded-checklist  (Slice D)
 *
 * Procedimiento ASISTIDO para pausar en Holded (NO hay API de pausa → nunca se
 * muta Holded ni se afirma que la pausa remota se ejecutó):
 *   mode:"inventory"     → CSV saneado de las recurrentes ACTIVAS para pausarlas
 *                          A MANO en Holded (export/checklist).
 *   mode:"mark-verified" → marca `pausedInHolded=true` SOLO con verificación
 *                          explícita del admin (registro, no ejecución remota).
 *
 * Admin-only, tenant, doble flag opt-in.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { recurringInvoicesEnabled, recurringPauseEnabled } from "@/lib/facturacion/recurring/flags";
import { holdedInventory, markPausedInHolded } from "@/lib/facturacion/recurring/pause-store";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  if (!(recurringInvoicesEnabled() && recurringPauseEnabled())) {
    return NextResponse.json({ error: { code: "disabled", message: "Checklist de Holded desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "mark-verified" ? "mark-verified" : "inventory";

  if (mode === "inventory") {
    const inv = await holdedInventory(prisma, api.workspaceId);
    return NextResponse.json({ mode, count: inv.rows.length, csv: inv.csv });
  }

  // mark-verified: requiere confirmación explícita (verified === true) del admin.
  const templateIds: string[] = Array.isArray(body.templateIds) ? body.templateIds.filter((x: any) => typeof x === "string").slice(0, 2000) : [];
  const verified = body.verified === true;
  if (!verified) {
    return NextResponse.json({ error: { code: "not_verified", message: "Debes confirmar que has verificado la pausa en Holded manualmente." } }, { status: 400 });
  }
  const res = await markPausedInHolded(prisma, api.workspaceId, templateIds, verified, api.userId ?? null, typeof body.note === "string" ? body.note : undefined);
  // Aviso explícito: esto NO ejecuta ninguna pausa en Holded.
  return NextResponse.json({ mode, ...res, note: "Registro de verificación manual. NO se ha ejecutado ninguna pausa en Holded (no existe API oficial)." });
});
