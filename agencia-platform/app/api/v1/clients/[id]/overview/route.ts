/**
 * GET /api/v1/clients/[id]/overview  (FASE 3 — Cliente 360)
 *
 * Resumen operativo AGREGADO de un cliente en UNA sola llamada (evita la cascada
 * de fetch de la pantalla actual). Tenant + rol aplicados; importes € gated a
 * admin; `accesos` nunca se expone; costes/rentabilidad-real = "sin datos".
 *
 * Aditivo y detrás de kill-switch HUB_CLIENT360 (off → 404). La pantalla de
 * cliente existente no cambia (fallback intacto).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { callerIsAdmin } from "@/lib/api/permissions";
import { getClientOverview } from "@/lib/clients/overview";
import { client360Enabled } from "@/lib/clients/flags";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "clients:read" }, async (_req, { params, api }) => {
  if (!client360Enabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Cliente 360 desactivado" } }, { status: 404 });
  }
  const clientId = String(params?.id ?? "");
  if (!clientId) return NextResponse.json({ error: { code: "bad_request", message: "Falta id de cliente" } }, { status: 400 });

  const isAdmin = await callerIsAdmin(api);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const healthConfigPartial = ((ws?.settings as any)?.clientHealth as any) ?? null;

  const overview = await getClientOverview(prisma, {
    workspaceId: api.workspaceId,
    clientId,
    isAdmin,
    healthConfigPartial
  });

  if (!overview) {
    return NextResponse.json({ error: { code: "not_found", message: "Cliente no encontrado" } }, { status: 404 });
  }
  return NextResponse.json(overview);
});
