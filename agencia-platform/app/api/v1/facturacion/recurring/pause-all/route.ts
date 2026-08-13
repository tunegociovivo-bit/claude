/**
 * POST /api/v1/facturacion/recurring/pause-all — PAUSA GLOBAL de emergencia (admin,
 * tenant-scoped): desactiva TODAS las plantillas recurrentes del workspace de una vez.
 * Seguro e idempotente (una plantilla ya pausada no cambia).
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { pauseAllRecurring } from "@/lib/invoicing/holded-recurring-import";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin", admin: true }, async (_req, { api }) => {
  await requireAdmin(api);
  const res = await pauseAllRecurring(api.workspaceId);
  console.warn(`[recurring] PAUSA GLOBAL ws=${api.workspaceId} paused=${res.paused} by=${api.userId ?? "?"}`);
  return NextResponse.json({ ok: true, paused: res.paused });
});
