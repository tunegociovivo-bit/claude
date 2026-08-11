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
import { getExceptionInbox } from "@/lib/exceptions/inbox";
import { exceptionsEnabled } from "@/lib/exceptions/flags";
import type { ExceptionFilters } from "@/lib/exceptions/engine";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "clients:read" }, async (req, { api }) => {
  if (!exceptionsEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Bandeja de excepciones desactivada" } }, { status: 404 });
  }
  const sp = new URL(req.url).searchParams;
  const filters: ExceptionFilters = {
    source: (sp.get("source") as any) || undefined,
    kind: (sp.get("kind") as any) || undefined,
    severity: (sp.get("severity") as any) || undefined,
    clientId: sp.get("clientId") || undefined
  };
  const limit = Number(sp.get("limit")) || undefined;

  const inbox = await getExceptionInbox(prisma, { workspaceId: api.workspaceId, filters, limit });
  return NextResponse.json(inbox);
});
