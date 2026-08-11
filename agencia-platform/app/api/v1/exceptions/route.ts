/**
 * GET /api/v1/exceptions  (FASE 4a — bandeja de excepciones unificada)
 *
 * Lista priorizada y deduplicada de incidencias que requieren intervención
 * humana (automatizaciones fallidas, aprobaciones pendientes, SLA vencidos,
 * facturas problemáticas, mensajes sin resolver, tareas bloqueadas), scoped por
 * workspace. Solo lectura; no expone importes €. Kill-switch HUB_EXCEPTIONS=off.
 *
 * Query: source, kind, severity, clientId, limit.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { callerIsAdmin } from "@/lib/api/permissions";
import { getExceptionInbox } from "@/lib/exceptions/inbox";
import { exceptionsEnabled } from "@/lib/exceptions/flags";
import { coerceFilters } from "@/lib/exceptions/engine";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "clients:read" }, async (req, { api }) => {
  if (!exceptionsEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Bandeja de excepciones desactivada" } }, { status: 404 });
  }
  const sp = new URL(req.url).searchParams;
  const filters = coerceFilters({ source: sp.get("source"), kind: sp.get("kind"), severity: sp.get("severity"), clientId: sp.get("clientId") });
  const limit = Number(sp.get("limit")) || undefined;

  // Los ítems de facturación (facturas vencidas) solo se incluyen para admin,
  // igual que el gestor de facturas (requireAdmin). No-admin no los ve.
  const includeBilling = await callerIsAdmin(api);

  const inbox = await getExceptionInbox(prisma, { workspaceId: api.workspaceId, filters, limit, includeBilling });
  return NextResponse.json(inbox);
});
